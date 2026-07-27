# Minimal in-cluster Kubernetes client for launching bulk-download tar Jobs on the warm EKS
# cluster (Forgejo #846 / SMP-1477 -- latency: <30s downloads on a dedicated, right-sized node).
#
# Dependency-free (Net::HTTP + the pod's ServiceAccount token/CA) -- no new gem. Talks to the
# in-cluster API server; only create/get on Jobs in the pod's own namespace are needed.
#
# RELIABILITY (SMP-1477 -- "the EKS bulk download has to work every single time"): the API server
# occasionally answers a submit with a transient failure -- a connection reset, a read timeout, a
# 5xx while a control-plane node rolls, a 429 when the apiserver is priority-throttling. The old
# aegea path wrapped its AWS shell-out in AegeaRetry (exponential backoff) for exactly these; the
# EKS rewrite has to keep that guarantee. So create_job retries ONLY transient signals with
# backoff+jitter, and is idempotent: the Job name is derived from the (unique) bulk-download id, so
# a retry that races a submit which actually landed gets a 409 AlreadyExists, which we treat as
# success by adopting the existing Job. That closes the at-least-once submit hole -- a download that
# really started is never reported as failed. Permanent failures (403/404/422/malformed) surface
# immediately with the real body, exactly as before.
require "net/http"
require "json"
require "openssl"

class KubeJobClient
  SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount".freeze

  class Error < StandardError; end

  # Retry policy. The apiserver is in-cluster (low latency), so back off faster than the AWS-facing
  # AegeaRetry: worst-case added latency ~ 0.5 + 1 + 2 = 3.5s (+/- jitter) before surfacing failure.
  DEFAULT_MAX_ATTEMPTS = 4 # 1 initial + 3 retries
  DEFAULT_BASE_DELAY = 0.5 # seconds; first backoff ~0.5s
  DEFAULT_MAX_DELAY = 8.0 # seconds; cap so we never sleep unboundedly inside a request
  DEFAULT_JITTER = 0.5 # +/- fraction of the computed delay

  # HTTP statuses worth retrying: apiserver priority throttling (429) and transient server-side
  # / control-plane-roll 5xx. Everything else (4xx auth/validation/not-found) is permanent.
  RETRYABLE_STATUS = %w[429 500 502 503 504].freeze

  # Transient transport failures worth retrying (connection blips, timeouts, TLS resets while a
  # control-plane node rolls). Permanent transport errors (e.g. bad CA) are not listed and surface.
  RETRYABLE_ERRORS = [
    Net::OpenTimeout, Net::ReadTimeout,
    Errno::ECONNRESET, Errno::ECONNREFUSED, Errno::ETIMEDOUT,
    Errno::EHOSTUNREACH, Errno::ENETUNREACH, Errno::EPIPE,
    EOFError, SocketError, IOError, OpenSSL::SSL::SSLError,
  ].freeze

  # True only when running inside a pod (the SA token is mounted). Lets specs/local skip it.
  def self.in_cluster?
    File.exist?("#{SA_DIR}/token")
  end

  def initialize
    @token     = File.read("#{SA_DIR}/token").strip
    @namespace = File.read("#{SA_DIR}/namespace").strip
    @ca_file   = "#{SA_DIR}/ca.crt"
    @host      = ENV.fetch("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc")
    @port      = ENV.fetch("KUBERNETES_SERVICE_PORT_HTTPS", ENV.fetch("KUBERNETES_SERVICE_PORT", "443"))
  end

  attr_reader :namespace

  # POST a Job manifest to batch/v1. Returns the created (or, on a 409, the already-existing) Job
  # hash; raises KubeJobClient::Error on any permanent failure (the caller wraps it in a typed
  # KickoffError). Transient failures are retried internally before either of those outcomes.
  #
  # retry_opts (max_attempts:, base_delay:, max_delay:, jitter:, sleeper:) exist for tests -- real
  # callers use the defaults.
  def create_job(manifest, **retry_opts)
    res = request_with_retry(Net::HTTP::Post, jobs_path, manifest, **retry_opts)

    case res
    when Net::HTTPSuccess
      JSON.parse(res.body)
    when Net::HTTPConflict
      # 409 AlreadyExists: a prior submit for this same bulk-download id already created the Job
      # (e.g. a retry after a submit whose response we never saw). The download IS running -- adopt
      # the existing Job rather than reporting a spurious failure. Idempotent by construction: the
      # Job name is unique per bulk-download id.
      adopt_existing_job(manifest, **retry_opts)
    else
      raise Error, "create job -> #{res.code}: #{res.body.to_s.slice(0, 500)}"
    end
  end

  # GET an existing Job by name (used to adopt a Job that a racing submit already created).
  def get_job(name, **retry_opts)
    res = request_with_retry(Net::HTTP::Get, "#{jobs_path}/#{name}", nil, **retry_opts)
    unless res.is_a?(Net::HTTPSuccess)
      raise Error, "get job #{name} -> #{res.code}: #{res.body.to_s.slice(0, 500)}"
    end

    JSON.parse(res.body)
  end

  private

  def jobs_path
    "/apis/batch/v1/namespaces/#{@namespace}/jobs"
  end

  def adopt_existing_job(manifest, **retry_opts)
    name = manifest.dig(:metadata, :name) || manifest.dig("metadata", "name")
    raise Error, "create job -> 409 Conflict but manifest has no metadata.name to adopt" if name.to_s.empty?

    Rails.logger.warn("[KubeJobClient] job #{name} already exists (409); adopting the running Job (idempotent submit).")
    get_job(name, **retry_opts)
  end

  # Issue `request`, retrying ONLY transient transport errors and RETRYABLE_STATUS responses with
  # exponential backoff + jitter. Returns the final Net::HTTPResponse (which may itself be a
  # non-retryable error status for the caller to classify). Raises KubeJobClient::Error only when a
  # transient transport error persists past the last attempt.
  def request_with_retry(klass, path, body = nil,
                         max_attempts: DEFAULT_MAX_ATTEMPTS,
                         base_delay: DEFAULT_BASE_DELAY,
                         max_delay: DEFAULT_MAX_DELAY,
                         jitter: DEFAULT_JITTER,
                         sleeper: nil)
    sleeper ||= ->(seconds) { sleep(seconds) }
    attempt = 0

    loop do
      attempt += 1
      begin
        res = request(klass, path, body)
      rescue *RETRYABLE_ERRORS => e
        if attempt >= max_attempts
          raise Error, "#{klass.name.split('::').last} #{path} failed after #{attempt} attempt(s): #{e.class}: #{e.message}"
        end

        sleep_backoff(attempt, max_attempts, base_delay, max_delay, jitter, sleeper, path, "#{e.class}: #{e.message}")
        next
      end

      if RETRYABLE_STATUS.include?(res.code) && attempt < max_attempts
        sleep_backoff(attempt, max_attempts, base_delay, max_delay, jitter, sleeper, path, "HTTP #{res.code}")
        next
      end

      return res
    end
  end

  def sleep_backoff(attempt, max_attempts, base_delay, max_delay, jitter, sleeper, path, reason)
    delay = backoff_delay(attempt, base_delay, max_delay, jitter)
    Rails.logger.warn(
      "[KubeJobClient] transient failure on #{path} (attempt #{attempt}/#{max_attempts}); " \
      "retrying in #{delay.round(2)}s. cause: #{reason}"
    )
    sleeper.call(delay)
  end

  # Exponential backoff (base * 2^(attempt-1)) capped at max_delay, with +/- jitter. Mirrors
  # AegeaRetry#backoff_delay so both launch paths share one retry shape.
  def backoff_delay(attempt, base_delay, max_delay, jitter)
    raw = base_delay * (2**(attempt - 1))
    capped = [raw, max_delay].min
    return capped if jitter.to_f <= 0

    spread = capped * jitter
    low = [capped - spread, 0.0].max
    high = capped + spread
    rand(low..high)
  end

  def request(klass, path, body = nil)
    uri  = URI("https://#{@host}:#{@port}#{path}")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl      = true
    http.ca_file      = @ca_file
    http.verify_mode  = OpenSSL::SSL::VERIFY_PEER
    http.open_timeout = 5
    http.read_timeout = 15
    req = klass.new(uri)
    req["Authorization"] = "Bearer #{@token}"
    req["Content-Type"]  = "application/json"
    req.body = body.to_json if body
    http.request(req)
  end
end

# Minimal in-cluster Kubernetes client for launching bulk-download tar Jobs on the warm EKS
# cluster (Forgejo #846 / SMP-1477 -- latency: <30s downloads on a dedicated, right-sized node).
#
# Dependency-free (Net::HTTP + the pod's ServiceAccount token/CA) -- no new gem. Talks to the
# in-cluster API server; only create/get/delete on Jobs in the pod's own namespace are needed.
require "net/http"
require "json"
require "openssl"

class KubeJobClient
  SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount".freeze

  class Error < StandardError; end

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

  # POST a Job manifest to batch/v1. Returns the created Job hash; raises KubeJobClient::Error on
  # any non-2xx (the caller wraps it in a typed KickoffError).
  def create_job(manifest)
    res = request(Net::HTTP::Post, "/apis/batch/v1/namespaces/#{@namespace}/jobs", manifest)
    unless res.is_a?(Net::HTTPSuccess)
      raise Error, "create job -> #{res.code}: #{res.body.to_s.slice(0, 500)}"
    end

    JSON.parse(res.body)
  end

  private

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

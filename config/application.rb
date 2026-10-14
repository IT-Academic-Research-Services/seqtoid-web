require_relative "boot"
require "rails/all"
require "sprockets/railtie"
require 'ougai'

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

module Czid
  def init_logging(config)
    ougai_logger = Ougai::Logger.new($stdout)
    ougai_logger.level = Ougai::Logger::TRACE
    ougai_logger.before_log = lambda do |data|
      # :request_id,
      data[:user_id] = CurrentContext.user_id
      data[:environment] = Rails.env
    end
    config.logger = ougai_logger
    config.active_record.verbose_query_logs = false
    config.colorize_logging = false

    # This is the _other_ JSON log Formatter that logs _after_ a REST call is made, containing request and response info.
    # {"method":"GET","path":"/up","format":"*/*","controller":"Rails::HealthController","action":"show","status":200,"allocations":239,"duration":5.07,"view":4.68,"db":0.0,"time":12509.095359829,"ddsource":["ruby"],"remote_ip":null,"user_id":null,"params":{}}
    # {"method":"GET","path":"/samples/dimensions.json","format":"json","controller":"SamplesController","action":"dimensions","status":200,"allocations":104589,"duration":350.85,"view":0.22,"db":91.61,"time":12508.690497849,"ddsource":["ruby"],"remote_ip":"1.2.3.4","user_id":789,"params":{"domain":"my_data","format":"json"}}
    config.lograge.enabled = true
    config.lograge.formatter = Lograge::Formatters::Raw.new
    config.lograge.logger = ougai_logger
    param_filtered = [] # %w[controller action] # TODO: Reset this if too spammy
    config.lograge.custom_options = lambda do |event|
      opt_hash = {
        time: event.time, # TODO: Transform to ISO8601
        ddsource: ["ruby"], # TODO: necessary?
        request_id: event.payload[:request_id],
        remote_ip: event.payload[:remote_ip],
        user_id: event.payload[:user_id],
        params: event.payload[:params].reject { |k| param_filtered.include? k },
      }

      current_span = OpenTelemetry::Trace.current_span
      if current_span&.context&.valid?
        opt_hash[:trace_id] = current_span.context.hex_trace_id
        opt_hash[:span_id] = current_span.context.hex_span_id
      end

      opt_hash.compact
    end
    config.lograge.ignore_actions = ["HealthCheck::HealthCheckController#index"]
    # Rails.application.configure do
    #   config.lograge.enabled = true
    #   config.lograge.formatter = Lograge::Formatters::Json.new # or Lines.new
    # end

    ActiveRecord::Base.logger = ougai_logger

    config.after_initialize do
      if Rails.logger
        # Extract the core logger if it's wrapped in ActiveSupport::TaggedLogging
        core_logger = Rails.logger.respond_to?(:logger) ? Rails.logger.logger : Rails.logger
        # Also update ActiveRecord's dedicated logger just to be completely safe
        ActiveRecord::Base.logger = core_logger
        # As well as OmniAuth
        OmniAuth.config.logger = core_logger
      end
    end
  end

  class Application < Rails::Application
    # Load configuration defaults from Rails 6.1, then opt in to individual Rails 7.0
    # framework defaults one at a time via config/initializers/new_framework_defaults_7_0.rb
    # (the Rails-sanctioned staged-upgrade pattern). We deliberately keep
    # `load_defaults 6.1` rather than flipping to 7.0 wholesale: a wholesale flip would
    # silently enable the two still-commented digest-class changes in that file
    # (`key_generator_hash_digest_class` / `hash_digest_class`), which invalidate all
    # existing encrypted cookies and cache entries -- a deployed-behavior change we are not
    # ready to make. Those get locked in only after Rails 7 is stable in production.
    config.load_defaults 6.1

    # cache_format_version -- set explicitly to the supported 7.0 format. The Rails 6.1
    # default (6.1) is deprecated under Rails 7.x and emits a boot-time deprecation warning
    # (CZID-295). Rails still reads pre-existing older-format entries; only NEW entries use
    # the 7.0 format. This app's caches are Redis (staging/prod/sandbox) or null_store
    # (dev/test), so entries simply re-populate. Per the upgrade guide this MUST be set
    # here in application.rb, not in the new_framework_defaults file.
    config.active_support.cache_format_version = 7.0
    # Note: `config.active_support.disable_to_s_conversion` was removed here -- it is
    # deprecated in Rails 7.1 and a no-op (the implicit Array/Hash #to_s conversion
    # was already removed in Rails 7.0), so the setting did nothing but emit a
    # deprecation warning. The `load_defaults 6.1 -> 7.x` advance is separate (CZID-127).

    # Configuration for the application, engines, and railties goes here.
    # These settings can be overridden in specific environments using the files
    # in config/environments, which are processed later.
    # config.eager_load_paths << Rails.root.join("extras")
    # CZID specific from here down
    config.time_zone = 'Pacific Time (US & Canada)'
    config.active_record.default_timezone = :local
    config.middleware.use Rack::Deflater
    config.encoding = "utf-8"

    # ActionMailer settings
    config.action_mailer.raise_delivery_errors = true
    config.action_mailer.perform_caching = false
    # Send via SES v2 using the AWS SDK. Credentials come from the default AWS
    # credential chain (IRSA in-cluster), so no static SMTP user/password is needed.
    # The :ses_v2 delivery method is registered by the aws-actionmailer-ses gem.
    config.action_mailer.delivery_method = :ses_v2
    config.action_mailer.ses_v2_settings = {
      region: "us-west-2",
    }

    # ResqueMiddleware to make it more secure:
    Dir["./app/middleware/*.rb"].sort.each do |file|
      require file
    end
    config.middleware.use ResqueMiddleware

    # This is an allowlist that protects against Host header spoofing. Only
    # seqtoid.org or subdomains are allowed. Test with a command such as:
    # curl -i -H $'Host: www.google.com' 'localhost:3000/auth0/login'
    config.hosts << 'seqtoid.org'
    config.hosts << '.seqtoid.org'
    # TODO: Is this necessary? Might not work if this is removed.
    config.hosts << '.us-west-2.elb.amazonaws.com'
    # Exclude the probe paths so LB/kubelet checks (which use the pod IP as Host) aren't 403'd:
    # /health_check (readiness) and the shallow /up liveness path (SMP-1473).
    # Also exclude the /internal/ service-to-service endpoints (Internal::ScreeningResultsController
    # and the screening decision callback): these are headless, HMAC-signature-authed, and are reached
    # over the in-cluster Service hostname (not a public host in config.hosts), so host authorization
    # would 403 them before the signature check runs. The signature is the real auth on these paths.
    config.host_authorization = { exclude: ->(request) { request.path == "/up" || request.path =~ /health_check/ || request.path.start_with?("/internal/") } }
    # Default heatmap/report background. Background ids differ per environment (env-prod's 2026-10-01 rebuild
    # has none of the old ids), so DEFAULT_BACKGROUND_ID overrides the historical 26. Where the id does not
    # exist, heatmap code falls back to the first public background (HeatmapIndexing.default_background_id).
    config.x.constants.default_background = Integer(ENV.fetch("DEFAULT_BACKGROUND_ID", "26"))

    # Include generic and useful information about system operation, but avoid logging too much
    # information to avoid inadvertent exposure of personally identifiable information (PII).
    config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info").to_sym
  end
end

HealthCheck.setup do |config|
  # The k8s liveness/readiness probes hit bare `/health_check`, which runs `standard_checks`.
  # Pin that set EXPLICITLY to liveness-appropriate checks only. On the Rails 7.2 image the
  # auto-detected `redis` and `elasticsearch` checks crept into `standard` and fail there --
  # the redis check connects to 127.0.0.1:6379 (not REDIS_URL) -> ECONNREFUSED, and the
  # elasticsearch check returns false -- so `/health_check` 500s and the liveness probe
  # crashloops the web pods (dev then silently serves on the previous image). A liveness probe
  # must not depend on downstream services (that turns a redis/ES blip into a web-tier outage);
  # it should only prove the process is up and can reach its DB. database + cache both return
  # 200 here. redis/elasticsearch remain available at /health_check/redis, /health_check/elasticsearch
  # for monitoring/readiness. (SMP-1297 / Rails 7.2 dev-deploy incident.)
  config.standard_checks = %w[database cache]
end

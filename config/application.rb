require_relative "boot"

require "rails/all"
require "sprockets/railtie"
# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

module Czid
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
    config.action_mailer.delivery_method = :smtp
    config.action_mailer.smtp_settings = {
      address: "email-smtp.us-west-2.amazonaws.com",
      authentication: :login,
      domain: "seqtoid.org",
      enable_starttls_auto: true,
      password: ENV["SMTP_PASSWORD"],
      port: 587,
      user_name: ENV["SMTP_USER"],
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
    config.host_authorization = { exclude: ->(request) { request.path == "/up" || request.path =~ /health_check/ } }
    config.x.constants.default_background = 26
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

# Staging (fresh seqtoid pre-prod, account 030998640247) mirrors the DEVELOPMENT environment, not the
# legacy czid staging config.
#
# The legacy staging.rb was a Rails-7.0, production-shaped file that does not boot a fresh seqtoid env:
# (1) `config.session_store = ...` aborts under Rails 7.1 ("Cannot assign to `session_store`"); (2)
# force_ssl=true risks a redirect loop (the ALB terminates TLS and the app sees http via
# X-Forwarded-Proto); (3) it derived hosts from Rails.env -> `staging.seqtoid.org`, which is the LIVE
# legacy infra's host (Jay's) and would host-auth-block our env-staging.seqtoid.org. So, exactly like
# sandbox.rb (#215), this is a self-contained, DEV-LIKE, env-driven config for the isolated env:
# secret_key_base + host come from ENV/Chamber, logs go to stdout, no force_ssl, forgiving errors. The
# local-only dev gems (Bullet, web-console) are omitted (they are not loaded when RAILS_ENV=staging).
require "active_support/core_ext/integer/time"

Rails.application.configure do
  # Settings specified here take precedence over config/application.rb.

  # secret_key_base from ENV (Chamber injects SECRET_KEY_BASE). Dev hardcodes a literal; a deployed
  # env must not, so this is the one deliberate divergence from development.rb.
  config.secret_key_base = ENV["SECRET_KEY_BASE"]

  config.cache_classes = true
  config.eager_load = true

  # Dev-like: show full error reports (this is a pre-prod rehearsal env, not customer-facing prod).
  config.consider_all_requests_local = true

  # Caching off, null store -- mirrors development.rb's default branch, no local toggle-file dependency.
  config.action_controller.perform_caching = false
  config.cache_store = :null_store

  config.public_file_server.enabled = ENV["RAILS_SERVE_STATIC_FILES"].present?
  config.assets.debug = true
  config.assets.quiet = true
  # #544: serve the stylesheet dynamically instead of raising AssetNotPrecompiledError (no precompile
  # step in the image). Same reason dev sets this.
  config.assets.check_precompiled_asset = false

  config.active_storage.service = :local

  # Dev-like: do NOT force SSL. The ALB terminates TLS and issues the https redirect (ingress
  # ssl-redirect annotation); the app sees http via X-Forwarded-Proto. force_ssl here would risk a
  # redirect loop.
  config.force_ssl = false

  config.log_level = :info
  config.log_tags = [:request_id]

  config.action_mailer.raise_delivery_errors = false
  config.action_mailer.default_url_options = { host: "env-staging.seqtoid.org" }

  # Host authorization: allow this env's host. Chamber sets SERVER_DOMAIN; honor it too (mirrors
  # development.rb's SERVER_DOMAIN handling) so the reachable host is always allow-listed.
  config.hosts << "env-staging.seqtoid.org"
  config.hosts << ENV["SERVER_DOMAIN"].sub("https://", "") if ENV["SERVER_DOMAIN"]

  # Leave asset_host unset unless a CDN endpoint is configured (relative URLs otherwise) -- as in dev.
  config.asset_host = ENV["CZID_CLOUDFRONT_ENDPOINT"]

  # CORS origins for this env's own hosts. See rack_cors.rb.
  config.allowed_cors_origins = [
    "https://env-staging.seqtoid.org",
    "https://www.env-staging.seqtoid.org",
    "https://assets.env-staging.seqtoid.org",
  ]

  config.middleware.use Rack::HostRedirect, "www.env-staging.seqtoid.org" => "env-staging.seqtoid.org"

  config.i18n.fallbacks = true
  config.active_support.deprecation = :log
  config.active_support.report_deprecations = false

  # Rails 7.1 removed the `config.session_store = ...` assignment form (it routes through
  # Railtie::Configuration#method_missing and raises "Cannot assign to `session_store`, it is a
  # configuration method"). Use the supported method-call form (same as prod.rb/sandbox.rb).
  config.session_store :cookie_store, key: "_czid_session"

  # Deployed logging: JSON lograge to stdout.
  config.lograge.enabled = true
  config.lograge.formatter = Lograge::Formatters::Json.new
  config.lograge.logger = ActiveSupport::Logger.new(STDOUT)
  param_filtered = %w[controller action]
  config.lograge.custom_options = lambda do |event|
    { time: event.time,
      ddsource: ["ruby"],
      remote_ip: event.payload[:remote_ip],
      user_id: event.payload[:user_id],
      params: event.payload[:params].reject { |k| param_filtered.include? k }, }
  end
  config.colorize_logging = false
  config.lograge.ignore_actions = ["HealthCheck::HealthCheckController#index"]
  ActiveRecord::Base.logger = Logger.new(STDOUT)

  # Do not dump schema after migrations (deployed env).
  config.active_record.dump_schema_after_migration = false

  logger           = ActiveSupport::Logger.new(STDOUT)
  logger.formatter = config.log_formatter
  config.logger    = ActiveSupport::TaggedLogging.new(logger)
  config.log_to = %w[stdout]
end

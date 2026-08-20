# env-prod (REAL prod, account 283694049553, host env-prod.seqtoid.org -> DNS-flips to seqtoid.org at
# go-live). Structurally a clone of staging.rb (the modern, self-contained, env-driven EKS config that
# actually boots a fresh seqtoid env) -- NOT the legacy prod.rb, which derives hosts from Rails.env and
# hardcodes a czid.org asset_host. The chart maps environment=env-prod -> RAILS_ENV=env-prod, so this
# file MUST exist or the app fails to boot.
#
# PROD HARDENING vs staging.rb (env-prod carries REAL P4 data + real users, so it is NOT a "show me the
# stack trace" rehearsal env):
#   - consider_all_requests_local = FALSE  -> generic error pages, never leak internals/stack traces to users
#   - assets debug OFF
# Everything else mirrors staging: secret_key_base + host from ENV/Chamber, no force_ssl (ALB terminates
# TLS), JSON lograge to stdout, cookie session store. asset_host stays ENV-driven and is UNSET in env-prod
# (CLOUDFRONT_ENDPOINT is deleted by chamber-seed) -> assets are served SAME-ORIGIN (no czid.org, no blank
# page).
require "active_support/core_ext/integer/time"

Rails.application.configure do
  # Settings specified here take precedence over config/application.rb.

  # secret_key_base from ENV (Chamber injects SECRET_KEY_BASE, fresh per env). A deployed env must never
  # hardcode a literal.
  config.secret_key_base = ENV["SECRET_KEY_BASE"]

  config.cache_classes = true
  config.eager_load = true

  # PROD HARDENING: do NOT show full error reports. Real users see generic error pages; stack traces and
  # internals never reach the client (P4 concern). This is the deliberate divergence from staging.rb.
  config.consider_all_requests_local = false

  # Caching off / null store for the first bring-up (mirrors staging; no local toggle-file dependency).
  # A real cache store (Redis) can be enabled later without changing boot behaviour.
  config.action_controller.perform_caching = false
  config.cache_store = :null_store

  config.public_file_server.enabled = ENV["RAILS_SERVE_STATIC_FILES"].present?
  config.assets.debug = false
  config.assets.quiet = true
  # #544: serve the stylesheet dynamically instead of raising AssetNotPrecompiledError (no precompile step
  # in the image).
  config.assets.check_precompiled_asset = false

  config.active_storage.service = :local

  # Do NOT force SSL. The ALB terminates TLS and issues the https redirect (ingress ssl-redirect
  # annotation); the app sees http via X-Forwarded-Proto. force_ssl here would risk a redirect loop.
  config.force_ssl = false

  config.log_level = :info
  config.log_tags = [:request_id]

  config.action_mailer.raise_delivery_errors = false
  config.action_mailer.default_url_options = { host: "env-prod.seqtoid.org" }

  # Host authorization: allow this env's host. Chamber sets SERVER_DOMAIN; honor it too so the reachable
  # host is always allow-listed. (At go-live the apex is added when SERVER_DOMAIN flips to seqtoid.org.)
  config.hosts << "env-prod.seqtoid.org"
  config.hosts << ENV["SERVER_DOMAIN"].sub("https://", "") if ENV["SERVER_DOMAIN"]

  # asset_host stays ENV-driven and is UNSET in env-prod (chamber-seed DELETEs CZID_CLOUDFRONT_ENDPOINT) ->
  # relative/same-origin asset URLs. Never the legacy czid.org fallback.
  config.asset_host = ENV["CZID_CLOUDFRONT_ENDPOINT"]

  # CORS origins for this env's own hosts. See rack_cors.rb.
  config.allowed_cors_origins = [
    "https://env-prod.seqtoid.org",
    "https://www.env-prod.seqtoid.org",
    "https://assets.env-prod.seqtoid.org",
  ]

  config.middleware.use Rack::HostRedirect, "www.env-prod.seqtoid.org" => "env-prod.seqtoid.org"

  config.i18n.fallbacks = true
  config.active_support.deprecation = :log
  config.active_support.report_deprecations = false

  # Rails 7.1: use the supported method-call form (assignment form raises "Cannot assign to `session_store`").
  config.session_store :cookie_store, key: "_czid_session"

  # Deployed logging: JSON lograge to stdout.
  config.lograge.enabled = true
  config.lograge.formatter = Lograge::Formatters::Json.new
  config.lograge.logger = ActiveSupport::Logger.new($stdout)
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
  ActiveRecord::Base.logger = Logger.new($stdout)

  # Do not dump schema after migrations (deployed env).
  config.active_record.dump_schema_after_migration = false

  logger           = ActiveSupport::Logger.new($stdout)
  logger.formatter = config.log_formatter
  config.logger    = ActiveSupport::TaggedLogging.new(logger)
  config.log_to = %w[stdout]
end

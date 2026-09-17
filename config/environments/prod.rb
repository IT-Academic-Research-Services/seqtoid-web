require "active_support/core_ext/integer/time"

Rails.application.configure do
  # Settings specified here will take precedence over those in config/application.rb.

  # secret_key_base -- sourced from ENV instead of the deprecated config/secrets.yml
  # (Rails.application.secrets was deprecated in 7.1, removed in 7.2). This is the same
  # value the app already used: secrets.yml read `<%= ENV["SECRET_KEY_BASE"] %>`, and
  # Rails already resolves ENV["SECRET_KEY_BASE"] ahead of secrets.yml -- no change to
  # the deployed key, just off the deprecated path.
  config.secret_key_base = ENV["SECRET_KEY_BASE"]

  # Code is not reloaded between requests.
  config.cache_classes = true

  # Eager load code on boot. This eager loads most of Rails and
  # your application in memory, allowing both threaded web servers
  # and those relying on copy on write to perform better.
  # Rake tasks automatically ignore this option for performance.
  config.eager_load = true

  # Full error reports are disabled and caching is turned on.
  config.consider_all_requests_local       = false
  config.action_controller.perform_caching = true
  # Guard the Redis cache store on REDISCLOUD_URL being present. Without the guard,
  # `ENV['REDISCLOUD_URL'] + '/0/cache'` is `nil + '/0/cache'` -> NoMethodError at config
  # load, which ABORTS boot before the app can serve anything. When the var is set the
  # behavior is unchanged; when it is unset we fall back to :null_store, matching how
  # development.rb degrades when caching is disabled. (#594)
  config.cache_store = if ENV['REDISCLOUD_URL'].present?
                         [:redis_cache_store,
                          {
                            url: ENV['REDISCLOUD_URL'] + '/0/cache',
                            # Needed for redis to evict keys in volatile-lru mode
                            expires_in: 30.days,
                          },]
                       else
                         :null_store
                       end
  # Rails 7.1 removed the `config.session_store = ...` assignment form: it routes through
  # Railtie::Configuration#method_missing and raises NoMethodError ("Cannot assign to
  # `session_store`, it is a configuration method"), aborting boot. Use the supported
  # method-call form instead. (#594)
  config.session_store :cookie_store, key: '_czid_session'
  # Ensures that a master key has been made available in either ENV["RAILS_MASTER_KEY"]
  # or in config/master.key. This key is used to decrypt credentials (and other encrypted files).
  # config.require_master_key = true

  # Disable serving static files from the `/public` folder by default since
  # Apache or NGINX already handles this.
  config.public_file_server.enabled = ENV["RAILS_SERVE_STATIC_FILES"].present?

  # Don't add an asset compressor here because we already minimize with webpack.
  # Check out webpack.config.prod.js.
  config.assets.debug = true
  # Suppress logger output for asset requests.
  config.assets.quiet = true

  # Do not fallback to assets pipeline if a precompiled asset is missed.
  # config.assets.compile = true

  # Specifies the header that your server uses for sending files.
  # config.action_dispatch.x_sendfile_header = "X-Sendfile" # for Apache
  # config.action_dispatch.x_sendfile_header = "X-Accel-Redirect" # for NGINX

  # Store uploaded files on the local file system (see config/storage.yml for options).
  config.active_storage.service = :local

  # Mount Action Cable outside main process or domain
  # config.action_cable.mount_path = nil
  # config.action_cable.url = "wss://example.com/cable"
  # config.action_cable.allowed_request_origins = [ "http://example.com", /http:\/\/example.*/ ]

  # Force all access to the app over SSL, use Strict-Transport-Security, and use secure cookies.
  config.force_ssl = true
  config.ssl_options = { redirect: { exclude: ->(request) { request.path =~ /health_check/ } } }

  # Prepend all log lines with the following tags.
  config.log_tags = [:request_id]

  config.serve_static_assets = true

  # Use a different cache store in production.
  # config.cache_store = :mem_cache_store

  # Use a real queuing backend for Active Job (and separate queues per environment).
  # config.active_job.queue_adapter     = :resque
  # config.active_job.queue_name_prefix = "idseq-#{Rails.env}"

  config.action_mailer.default_url_options = { host: 'czid.org' }

  # We configure IDseq to use cloudfront CDN when available.
  config.asset_host = ENV["CZID_CLOUDFRONT_ENDPOINT"] || "czid.org"
  # Custom config for idseq to enable CORS headers by environment. See rack_cors.rb.
  config.allowed_cors_origins = [
    "https://idseq.net",
    "https://www.idseq.net",
    "https://assets.idseq.net",
    "https://prod.idseq.net",
    "https://assets.prod.idseq.net",
    "https://czid.org",
    "https://www.czid.org",
    "https://assets.czid.org",
    "https://prod.czid.org",
    "https://assets.prod.czid.org",
  ]

  config.middleware.use Rack::HostRedirect, 'www.idseq.net' => 'idseq.net'
  config.middleware.use Rack::HostRedirect, 'www.czid.org' => 'czid.org'

  # Enable locale fallbacks for I18n (makes lookups for any locale fall back to
  # the I18n.default_locale when a translation cannot be found).
  config.i18n.fallbacks = true

  # Don't log any deprecations.
  config.active_support.report_deprecations = false

  # Deployed logging configuration
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
  config.lograge.ignore_actions = ["HealthCheck::HealthCheckController#index"]
  ActiveRecord::Base.logger.level = 1 if ActiveRecord::Base.logger

  # Do not dump schema after migrations.
  config.active_record.dump_schema_after_migration = false

  # Set the logging destination(s)
  config.log_to = %w[stdout]
end

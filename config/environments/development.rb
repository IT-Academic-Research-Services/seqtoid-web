require "active_support/core_ext/integer/time"

Rails.application.configure do
  # Settings specified here will take precedence over those in config/application.rb.

  # In the development environment your application's code is reloaded any time
  # it changes. This slows down response time but is perfect for development
  # since you don't have to restart the web server when you make code changes.
  # config.cache_classes = false
  # Code is not reloaded between requests.
  config.cache_classes = true

  # Eager load code on boot. This eager loads most of Rails and
  # your application in memory, allowing both threaded web servers
  # and those relying on copy on write to perform better.
  # Rake tasks automatically ignore this option for performance.
  config.eager_load = true

  # Show full error reports.
  config.consider_all_requests_local = true
  # Enable server timing
  config.server_timing = true

  # Enable/disable caching. By default caching is disabled.
  # Run rails dev:cache to toggle caching.
  if Rails.root.join("tmp/caching-dev.txt").exist?
    config.action_controller.perform_caching = true
    config.action_controller.enable_fragment_cache_logging = true

    config.cache_store = :redis_cache_store,
                         {
                           url: "#{ENV['REDISCLOUD_URL'] || 'redis://redis:6379'}/0/cache",
                           # Needed for redis to evict keys in volatile-lru mode
                           expires_in: 30.days,
                         }
    config.session_store = :cookie_store, {
      key: '_czid_session',
    }
    config.public_file_server.headers = {
      "Cache-Control" => "public, max-age=#{2.days.to_i}",
    }
  else
    config.action_controller.perform_caching = false
    # Use a different cache store in production.
    # config.cache_store = :mem_cache_store
    config.cache_store = :null_store
  end

  # Ensures that a master key has been made available in either ENV["RAILS_MASTER_KEY"]
  # or in config/master.key. This key is used to decrypt credentials (and other encrypted files).
  # config.require_master_key = true

  # Disable serving static files from the `/public` folder by default since
  # Apache or NGINX already handles this.
  config.public_file_server.enabled = ENV['RAILS_SERVE_STATIC_FILES'].present?

  # Don't add an asset compressor here because we already minimize with webpack.
  # Check out webpack.config.prod.js.
  config.assets.debug = true
  # Suppress logger output for asset requests.
  config.assets.quiet = true

  # Do not fallback to assets pipeline if a precompiled asset is missed.
  # config.assets.compile = true

  # Specifies the header that your server uses for sending files.
  # config.action_dispatch.x_sendfile_header = 'X-Sendfile' # for Apache
  # config.action_dispatch.x_sendfile_header = 'X-Accel-Redirect' # for NGINX

  # Store uploaded files on the local file system (see config/storage.yml for options).
  config.active_storage.service = :local

  # Mount Action Cable outside main process or domain
  # config.action_cable.mount_path = nil
  # config.action_cable.url = 'wss://example.com/cable'
  # config.action_cable.allowed_request_origins = [ 'http://example.com', /http:\/\/example.*/ ]

  # Force all access to the app over SSL, use Strict-Transport-Security, and use secure cookies.
  config.force_ssl = true
  config.ssl_options = { redirect: { exclude: ->(request) { request.path =~ /health_check/ } } }

  # Include generic and useful information about system operation, but avoid logging too much
  # information to avoid inadvertent exposure of personally identifiable information (PII).
  config.log_level = :debug

  # Prepend all log lines with the following tags.
  config.log_tags = [:request_id]

  # Use a real queuing backend for Active Job (and separate queues per environment).
  # config.active_job.queue_adapter     = :resque
  # config.active_job.queue_name_prefix = "idseq-dev"

  # Don't care if the mailer can't send.
  config.action_mailer.raise_delivery_errors = false

  # CZID specific
  # Required for tests to pass
  config.action_mailer.default_url_options = { host: 'localhost', port: 3000 }
  # config.action_mailer.default_url_options = { host: "dev.seqtoid.org" }

  # Print deprecation notices to the Rails logger.
  config.active_support.deprecation = :log

  # Raise exceptions for disallowed deprecations.
  config.active_support.disallowed_deprecation = :raise

  # Tell Active Support which deprecation messages to disallow.
  config.active_support.disallowed_deprecation_warnings = []

  # Raise an error on page load if there are pending migrations.
  config.active_record.migration_error = :page_load

  # Highlight code that triggered database queries in logs.
  config.active_record.verbose_query_logs = true

  config.hosts << "dev.seqtoid.org"

  # Raises error for missing translations. See config.i18n.fallbacks below
  # config.i18n.raise_on_missing_translations = true

  # Annotate rendered view with file names.
  # config.action_view.annotate_rendered_view_with_filenames = true

  # Using default file watcher because inotify does not work with arm64
  # dev environments.  If inotify eventually works with arm64 on qemu, consider
  # switching back to the EventedFileUpdateChecker
  config.file_watcher = ActiveSupport::FileUpdateChecker

  # Here down is CZID-added code, not Rails-generated
  # Uncomment this line to test cloudfront CDN. Must be running staging branch,
  # so that filename hashes match.
  # config.action_controller.asset_host = 'assets.dev.seqtoid.org'
  # config.action_controller.asset_host = proc { |source|
  #   "http://localhost:8080" if source =~ /wp_bundle\.js$/i
  # }
  config.asset_host = ENV["CZID_CLOUDFRONT_ENDPOINT"] || "dev.seqtoid.org"
  # Uncomment if you wish to allow Action Cable access from any origin.
  # config.action_cable.disable_request_forgery_protection = true

  # Custom config for idseq to enable CORS headers by environment. See rack_cors.rb.
  config.allowed_cors_origins = [
    "https://dev.seqtoid.org",
    "https://www.dev.seqtoid.org",
    "https://assets.dev.seqtoid.org",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ]

  # web is the container name for the rails server in our docker config
  # Rails > 6 requires hosts to be explicitly allow listed
  config.hosts << "web"
  config.hosts << "web.czidnet"

  config.middleware.use Rack::HostRedirect, "www.dev.seqtoid.org" => "dev.seqtoid.org"

  # Enable locale fallbacks for I18n (makes lookups for any locale fall back to
  # the I18n.default_locale when a translation cannot be found).
  config.i18n.fallbacks = true

  # Send deprecation notices to registered listeners.
  config.active_support.deprecation = :notify

  # SERVER_DOMAIN is used for callback URLs for ECS bulk downloads
  # In local development, an ngrok http endpoint must be configured for ECS bulk downloads to work
  # See https://github.com/chanzuckerberg/czid-web-private/wiki/1.6-Dev-%E2%80%90-ECS-Bulk-Downloads-on-Localdev
  # This setting prevents Rails from blocking requests to the ngrok endpoint
  config.hosts << ENV["SERVER_DOMAIN"].sub("https://", "") if ENV["SERVER_DOMAIN"]

  # Deployed logging configuration
  config.log_level = :debug
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
  ActiveRecord::Base.logger.level = :debug if ActiveRecord::Base.logger

  # Do not dump schema after migrations.
  config.active_record.dump_schema_after_migration = true

  # Development logging configuration
  logger           = ActiveSupport::Logger.new(STDOUT)
  logger.formatter = config.log_formatter
  config.logger    = ActiveSupport::TaggedLogging.new(logger)
  config.log_to = %w[stdout file]
  config.active_record.verbose_query_logs = true

  config.after_initialize do
    Bullet.enable = true
    Bullet.bullet_logger = true
    Bullet.console = true
    Bullet.rails_logger = true
    Bullet.skip_html_injection = false
  end
end

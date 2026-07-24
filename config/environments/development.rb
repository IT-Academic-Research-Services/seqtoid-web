require "active_support/core_ext/integer/time"

Rails.application.configure do
  # Settings specified here will take precedence over those in config/application.rb.

  # secret_key_base -- set explicitly here instead of the deprecated config/secrets.yml
  # (Rails.application.secrets was deprecated in 7.1, removed in 7.2). Value is the same
  # literal previously used for the `development` env in secrets.yml, so existing dev
  # signed/encrypted cookies remain valid (no behavior change).
  config.secret_key_base = "65a7f60b81e0becf08bff85b70a16768559e1737f37922d1807fe5d98ba45e9cf3b8ffcb64d313d0a4f8bae97e1b443c4020f5ea72c9d33984f822f4ccd4332e"

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

  # #544: the deployed dev env runs RAILS_ENV=development and serves assets
  # dynamically (config.assets.compile defaults true) -- it does NOT run
  # `assets:precompile` at image build time (that step was tried and reverted in
  # #204/#210 because it boots RAILS_ENV=production, which this app has no DB
  # config for). With Sprockets 4 the only precompile source is manifest.js, and
  # `application.css` is declared there (`//= link application.css`). But with
  # config.assets.debug = true the stylesheet_link_tag helper takes the
  # find_debug_asset path and raises AssetNotPrecompiledError (HTTP 500 --
  # HomeController#landing, DEV-RAILS-PROJECT-B) unless the asset is in the
  # precompiled manifest, which does not exist without a precompile step.
  # Disable the precompiled-asset check so dev compiles/serves the stylesheet
  # dynamically instead of 500ing. Dev-only; leaves staging/prod untouched.
  config.assets.check_precompiled_asset = false

  # Specifies the header that your server uses for sending files.
  # config.action_dispatch.x_sendfile_header = 'X-Sendfile' # for Apache
  # config.action_dispatch.x_sendfile_header = 'X-Accel-Redirect' # for NGINX

  # Store uploaded files on the local file system (see config/storage.yml for options).
  config.active_storage.service = :local

  # Mount Action Cable outside main process or domain
  # config.action_cable.mount_path = nil
  # config.action_cable.url = 'wss://example.com/cable'
  # config.action_cable.allowed_request_origins = [ 'http://example.com', /http:\/\/example.*/ ]

  # CZID-279: do NOT force SSL in local development. Puma serves plain http on
  # localhost and there is no local TLS cert, so force_ssl makes every browser
  # request 301-redirect to https://localhost and fail to connect. SSL is still
  # enforced in staging/sandbox/prod (see their environment files).
  config.force_ssl = false

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
  # CZID-279: when no CDN endpoint is configured (local dev), leave asset_host
  # unset so assets are served by the local Rails server (relative URLs).
  # The old hardcoded "dev.seqtoid.org" fallback made the browser fetch the JS/CSS
  # bundles from a host that doesn't resolve locally, so the React app never loaded
  # (blank page). A real dev/CDN deploy still sets CZID_CLOUDFRONT_ENDPOINT.
  config.asset_host = ENV["CZID_CLOUDFRONT_ENDPOINT"]
  # Uncomment if you wish to allow Action Cable access from any origin.
  # config.action_cable.disable_request_forgery_protection = true

  # Custom config for idseq to enable CORS headers by environment. See rack_cors.rb.
  config.allowed_cors_origins = [
    "https://dev.seqtoid.org",
    "https://www.dev.seqtoid.org",
    "https://assets.dev.seqtoid.org",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    # Per-PR preview sandboxes (pr-<N>.dev.seqtoid.org, #616/#697).
    #
    # THIS ENTRY IS FOR THE DEV APP, NOT THE SANDBOX. assets.dev.seqtoid.org is a CloudFront
    # distribution whose ORIGIN is this Rails app (dev/web assets.tf), so when a sandbox page
    # loads a font from the CDN, it is THIS app that decides whether that origin may read it.
    # Without this, every icon font is blocked -- "Access to font at
    # https://assets.dev.seqtoid.org/assets/fontawesome-webfont.woff2 from origin
    # https://pr-25.dev.seqtoid.org has been blocked by CORS policy" -- and the UI renders empty
    # boxes where the dropdown arrows should be. Fonts are CORS-restricted by browsers while
    # JS/CSS are not, which is why sandboxes looked ALMOST right.
    #
    # A Regexp because PR numbers are unbounded and the list cannot enumerate them (rack-cors
    # 3.0.0 handles Regexp origins: resources.rb `when Proc, Regexp, ...`). It grants no access:
    # rack_cors.rb scopes this allow-block to `resource '/assets/*'`, so it only permits reading
    # public front-end assets a sandbox already fetches -- no API, no data. Anchored, so
    # pr-25.dev.seqtoid.org.evil.com and evil-pr-25.dev.seqtoid.org do NOT match.
    %r{\Ahttps://pr-\d+\.dev\.seqtoid\.org\z},
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

  # Deployed logging configuration.
  #
  # Overridable via RAILS_LOG_LEVEL, defaulting to :debug so a local `development`
  # boot is unchanged. The deployed dev environment sets it to "info".
  #
  # At :debug, ActiveRecord echoes every statement WITH its bound values. On the
  # resque worker that means whole `INSERT INTO contigs` statements including the
  # `sequence` column: measured single log lines up to 484 KB, a 12 KB mean against
  # a 106 B median, and roughly three quarters of all container log bytes in the dev
  # cluster from this one process. Two problems, not one -- the volume, and the fact
  # that sample sequence content is written verbatim into a log stream that ships to
  # an aggregator (and, if enabled, to a third-party log vendor).
  #
  # Only `development` had this: sandbox/staging/prod already run :info.
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "debug").to_sym
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

  # Allow web-console's error page (with the full exception body) to render for
  # requests coming from the Docker bridge network. By default web-console only
  # trusts loopback, so in local docker-compose dev (client IP is the 172.16/12
  # bridge, not 127.0.0.1) it blanks the 500 body and hides the real exception.
  # LOCAL/dev-only -- this file is the development env and is never loaded in a
  # deployed environment. See CZID-298.
  config.web_console.permissions = "172.16.0.0/12"
end

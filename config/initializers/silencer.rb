require 'silencer/rails/logger'

Rails.application.configure do
  # config.middleware.swap Rails::Rack::Logger, TokenMaskingLogger, silence: ["/health_check"]
  # Suppress messages like HealthCheck::HealthCheckController#index or Rails::HealthController#show ErrorsController#not_found
  # return false if log.message =~ /HealthCheckController/
  # Suppress messages like: {"method":"GET","path":"/up","format":"*/*","controller":"Rails::HealthController","action":"show","status":200 ...}
  # log.payload&.dig(:path) != "/up" && log.name != "ActionView::Base"
  config.middleware.insert_before(
    RailsSemanticLogger::Rack::Logger,
    SemanticLoggerSilencer,
    silence: ["/health_check"]
  )

  #
  # Define common semantic_logger filters and transformers
  #

  # Logging.add_filter(lambda { |log|
  #   Suppress messages like: 'ActionController::RoutingError (No route matches [GET] "..."):'
  #
  #   true
  # })

  # Filters :access_token from bulk-download callback request (SMP-1751).
  # Rails builds its Log message straight from the request path,
  # and filter_parameters only redacts the query string -- never path segments.
  # The bulk-download callback routes carry the single-use BulkDownload#access_token as a path segment,
  # so without this, the token reaches the log sink on EVERY callback, the success path included, not just on failure (SMP-1751).
  Logging.add_transformer(lambda { |log|
    log.payload[:path] = SecretRedaction.redact_bulk_download_callback_token(log.payload[:path]) if log.payload&.dig(:path)
    log.named_tags[:url] = SecretRedaction.redact_bulk_download_callback_token(log.named_tags[:url]) if log.named_tags&.dig(:url)
  })

  # Filters and transformers for development only
  if Rails.env.development?
    # Filter out noisy debug messages, but keep those we want to see, especially when running locally.
    RENDER_MESSAGES = Set["Rendering", "Rendered", "Rendering layout", "Rendered layout"].freeze
    Logging.add_filter(lambda { |log|
      # return false if log.message == 'Rendering text template' || log.message == 'Rendering html template'
      return false if RENDER_MESSAGES.include?(log.message) && (log.payload&.key?(:template) || log.payload&.key?(:partial))

      true
    })
  end
end

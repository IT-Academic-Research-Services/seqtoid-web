require 'silencer/rails/logger'

Rails.application.configure do
  # TokenMaskingLogger is Silencer::Logger plus masking of the bulk-download
  # callback access_token in the request-start log line (SMP-1751). It keeps the
  # /health_check silencing this swap has always provided. The class is defined in
  # app/middleware and required at boot by config/application.rb.
  config.middleware.swap Rails::Rack::Logger, TokenMaskingLogger, silence: ["/health_check"]
end

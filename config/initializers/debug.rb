# TODO: Disabled debugger for now, as it interferes with JSON logging, and is currently unused.
# if Rails.env.development? && defined?(::Rails::Server)
#   require 'debug/session'
#   Rails.logger.info "Starting debug session"
#   DEBUGGER__.open(port: "12345", host: "0.0.0.0")
# end

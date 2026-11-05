# Remote Ruby debugger for local VSCode attach (docker-compose only).
#
# Opt-in via RUBY_DEBUG_SERVER=1 (set in docker-compose.yml). It used to open on every
# development boot, but the deployed dev cluster and the preview sandboxes also run
# RAILS_ENV=development. There it:
#   - exposed an unauthenticated debugger on 0.0.0.0:12345 in every pod, and
#   - broke the pipeline/result monitors: the parent `rake pipeline_monitor` holds 12345,
#     so every respawned `rake pipeline_monitor[finite_duration]` child aborted at boot
#     with EADDRINUSE (raised from the debugger's server thread, so it cannot be rescued
#     here). A polling sandbox therefore never advanced run status or loaded results.
if Rails.env.development? && defined?(::Rails::Server) && ENV["RUBY_DEBUG_SERVER"] == "1"
  require 'debug/session'
  Rails.logger.info "Starting debug session"
  DEBUGGER__.open(port: "12345", host: "0.0.0.0")
end

# frozen_string_literal: true

require "silencer/rails/logger"
require "./lib/secret_redaction"

# Rails builds its "Started POST \"<path>\" for <ip> at <time>" request-log line
# straight from the request path, and filter_parameters only redacts the query
# string -- never path segments. The bulk-download callback routes carry the
# single-use BulkDownload#access_token as a path segment, so without this the
# token reaches the log sink (stdout -> CloudWatch/Loki/Grafana) verbatim on
# EVERY callback, the success path included, not just on failure (SMP-1751).
#
# We already swap Rails' request logger for Silencer's (to silence /health_check
# -- see config/initializers/silencer.rb), so we extend that same logger and
# mask the token in the request-start line before it is written. started_request_
# message is the single place the raw path is formatted into the log; every other
# request logs exactly as before, since a non-matching line passes through
# SecretRedaction.redact_bulk_download_callback_token untouched.
class TokenMaskingLogger < Silencer::Logger
  private

  def started_request_message(request)
    SecretRedaction.redact_bulk_download_callback_token(super)
  end
end

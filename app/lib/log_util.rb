# frozen_string_literal: true

class LogUtil
  def self.log_error(message, exception: nil, **details)
    # TODO(tiago): [CH-13826] add json support
    Rails.logger.error({
      message: message,
      exception: exception&.message,
      backtrace: exception&.backtrace,
      details: details,
    }.to_json)
    if exception
      # Exceptions have a default level of "error".
      # sentry-ruby's capture_exception uses the exception's own message as the
      # event title and does not accept a `message:` option, so carry the caller's
      # message through as extra context to preserve raven's behavior.
      Sentry.capture_exception(
        exception,
        extra: details.merge(message: message)
      )
    end
  end

  # If you want to report a message rather than an exception you can use the log_message method.
  #
  # The message is ALWAYS written to the structured app log (Rails.logger.info -> stdout ->
  # CloudWatch/Loki/Grafana), so the operational signal is durably captured for monitoring.
  # Sentry capture is opt-OUT via `to_sentry:`: purely-operational INFO (self-heal notices,
  # support-request summaries, periodic job rollups) should live in the logs, not create issues
  # in the Sentry ERROR project. Default true preserves existing callers; pass to_sentry: false
  # for operational messages that are not application errors (SMP-1596/1597/1598).
  def self.log_message(message, to_sentry: true, **details)
    Rails.logger.info({ message: message, details: details }.to_json)
    return unless to_sentry

    Sentry.capture_message(
      message,
      level: "info",
      extra: details
    )
  end
end

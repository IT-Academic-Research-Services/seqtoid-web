# frozen_string_literal: true

class LogUtil
  def self.log_exception(exception, message: nil, level: :error, to_sentry: true, **details)
    begin
      Rails.logger.send(
        level,
        message.presence || exception.to_s,
        exception,
        **details.compact
      )
    rescue StandardError
      Rails.logger.error("[#{level}] to_sentry [#{to_sentry}] #{exception&.inspect} #{details.inspect}")
    end

    # Exceptions have a default level of "error".
    # sentry-ruby's capture_exception uses the exception's own message as the
    # event title and does not accept a `message:` option, so carry the caller's
    # message through as extra context to preserve raven's behavior.
    if to_sentry
      Sentry.capture_exception(
        exception,
        level: level,
        extra: {
          message: message,
          **details,
        }.compact
      )
    end
  end

  def self.log_error(message, exception: nil, level: :error, to_sentry: true, **details)
    if exception.nil?
      log_message(message, level: level, to_sentry: to_sentry, **details)
    else
      log_exception(exception, message: message, level: level, to_sentry: to_sentry, **details)
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
  def self.log_message(message, level: :info, to_sentry: true, **details)
    # A logging helper must never raise and disturb its caller. Guard the JSON encode
    # (a detail value could be non-serializable) and fall back to inspect.
    begin
      Rails.logger.send(level, message, **details.compact)
    rescue StandardError
      Rails.logger.info("#{message} #{details.inspect}")
    end
    return unless to_sentry

    Sentry.capture_message(
      message,
      level: level,
      extra: details.compact
    )
  end
end

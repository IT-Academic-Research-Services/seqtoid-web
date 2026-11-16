# frozen_string_literal: true

class LogUtil
  def self.log_exception(exception, message: nil, level: :error, **details)
    begin
      Rails.logger.send(
        level,
        message.presence || exception.to_s,
        exception,
        **details.compact
      )
    rescue StandardError
      Rails.logger.error("[#{level}] #{exception&.inspect} #{details.inspect}")
    end

    # Exceptions have a default level of "error".
    # sentry-ruby's capture_exception uses the exception's own message as the
    # event title and does not accept a `message:` option, so carry the caller's
    # message through as extra context to preserve raven's behavior.
    Sentry.capture_exception(
      exception,
      level: level,
      extra: {
        message: message,
        **details,
      }.compact
    )
  end

  def self.log_error(message, exception: nil, **details)
    if exception.nil?
      log_message(message, level: :error, **details)
    else
      log_exception(exception, message: message, level: :error, **details)
    end
  end

  # If you want to report a message rather than an exception you can use the log_message method.
  # TODO: Obsolete this, and use log_exception() or log_message() instead
  # The message is ALWAYS written to the structured app log (Rails.logger.info -> stdout ->
  # CloudWatch/Loki/Grafana), so the operational signal is durably captured for monitoring. (SMP-1596/1597/1598).
  def self.log_message(message, level: :info, **details)
    # A logging helper must never raise and disturb its caller. Guard the JSON encode
    # (a detail value could be non-serializable) and fall back to inspect.
    begin
      Rails.logger.send(level, message, **details.compact)
    rescue StandardError
      Rails.logger.info("#{message} #{details.inspect}")
    end

    Sentry.capture_message(
      message,
      level: level,
      extra: details.compact
    )
  end
end

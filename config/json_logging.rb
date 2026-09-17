# frozen_string_literal: true

class JsonLogFormatter < ActiveSupport::Logger::SimpleFormatter
  # Safely convert different message types into text or structures
  def format_message(message)
    case message
    when Hash, Array
      message
    when Exception
      # "#{msg.message} (#{msg.class}):\n" + (msg.backtrace || []).join("\n")
      { error: message.class.name, message: message.message, backtrace: message.backtrace&.first(10) }
    when String
      message.strip.gsub(/\e\[\d+m/, '')
    when Object
      message.inspect
    else
      # Strip out default color escape sequences if necessary
      message&.to_s&.strip&.gsub(/\e\[\d+m/, '')
    end
  end

  def call(severity, timestamp, progname, msg)
    {
      time: timestamp.iso8601,
      level: severity,
      progname: progname,
      message: format_message(msg),
    }.compact.to_json + "\n"
  end
end

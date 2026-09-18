# frozen_string_literal: true

class JsonLogFormatter < ActiveSupport::Logger::SimpleFormatter
  def initialize
    super
    @tags = []
  end

  def call(severity, timestamp, progname, msg)
    current_tags = Rails.logger.respond_to?(:formatter) ? Rails.logger.formatter.current_tags : []
    {
      timestamp: timestamp.iso8601,
      level: severity,
      progname: progname,
      message: format_message(msg),
      tags: current_tags,
    }.compact.to_json + "\n"
  end

  # TaggedLogging compatibility methods
  def push_tags(*tags)
    tags.flatten.reject(&:blank?).each do |tag|
      @tags << tag
    end
  end

  def pop_tags(size = 1)
    @tags.pop(size)
  end

  def clear_tags!
    @tags.clear
  end

  def current_tags
    @tags.dup
  end

  private

  # Safely convert different message types into text or structures
  def format_message(message)
    case message
    when Hash, Array
      message
    when Exception
      # "#{msg.message} (#{msg.class}):\n" + (msg.backtrace || []).join("\n")
      { error: message.class.name, message: message.message, backtrace: message.backtrace&.first(10) }
    when String
      # Strip out default color escape sequences if necessary
      message.strip.gsub(/\e\[\d+m/, '')
    when Object
      message.inspect
    else
      # Strip out default color escape sequences if necessary
      message&.to_s&.strip&.gsub(/\e\[\d+m/, '')
    end
  end
end

# frozen_string_literal: true

require 'rails_semantic_logger'
require 'semantic_logger'
require "semantic_logger_datadog"

module Logging
  class CurrentContext < ActiveSupport::CurrentAttributes
    # Used in ApplicationRecord.log_analytics. Usually set by the ApplicationController.
    # See https://stackoverflow.com/a/11670283/200312
    # TODO: Eventually remove these, as they are only used by ApplicationRecord for reporting metrics.
    attribute :user
    attribute :request
  end

  # Add/remove fields of a semantic_logger log object
  TRANSFORMERS = [lambda { |log|
    # log.delete[:level_index] # Extra spam we just don't need
    # log.delete[:logger] # Always the same `name` "SemanticLogger::Appender::IO", with redundant `thread_name`

    # :usr is set in :named_tags in the ApplicationController, and needs to be in :payload for the Datadog JSON formatter to pick it up
    if (usr = log.named_tags&.delete(:usr))
      log.payload ||= {}
      log.payload[:usr] ||= {}
      log.payload[:usr].merge!(usr)
    end

    current_span_context = OpenTelemetry::Trace.current_span&.context
    if current_span_context&.valid?
      log.payload ||= {}
      log.payload[:trace_id] ||= current_span_context.hex_trace_id
      log.payload[:span_id] ||= current_span_context.hex_span_id
    end

    # Logging unpermitted_parameters sometimes causes infinite-recursion when JSON serializing the params.
    # Calling as_json on ActionController::Base or ActionDispatch::Request commonly causes this infinite-recursion.
    # IE: ActionController::Base and ActionDispatch::Request reference each other
    # Throws: SystemStackError("stack level too deep")
    if log.payload&.dig(:context, :request)
      log.payload[:context] = log.payload[:context].except(:request)
    end
  }]

  private_constant :TRANSFORMERS

  def self.add_transformer(transformer)
    TRANSFORMERS << transformer
  end

  # Temporarily add lambdas that transform logged JSON messages
  def self.with_transformers(*transformers, &block)
    SemanticLogger.named_tagged(
      transformers: (SemanticLogger.named_tags[:transformers] || []) + transformers,
      &block
    )
  end

  def self.transform(log)
    transformers = log.named_tags.delete(:transformers) || []
    TRANSFORMERS.each { |transformer| transformer.call(log) }
    transformers.each { |transformer| transformer.call(log) }
    log
  end

  class Formatter < SemanticLoggerDatadog::Formatters::Json
    def call(log, logger)
      # super(Logging.transform(log), logger)
      super(log, logger)
    rescue SystemStackError, StandardError => e
      # Sadly, sometimes as_json fails, so we need to at least track that it happened.
      # IE: stack-overflow during JSON serialization due to circular-composition
      fallback_log = SemanticLogger::Log.new(log.name, :error)
      fallback_log.message = "Failed to serialize log payload to JSON: #{log.message}"
      fallback_log.exception = e
      fallback_log.payload = { original_payload: log.payload.inspect } if log.payload.is_a?(Hash)

      super(fallback_log, logger)
    end
  end

  private_constant :Formatter

  DEFAULT_FORMATTER = Formatter.new

  FILTERS = [] # ->(log) { log.message !~ /BOOT/ }]

  private_constant :FILTERS

  def self.add_filter(filter)
    FILTERS << filter
  end

  # Temporarily add lambdas that filter logged JSON messages
  def self.with_filters(*filters, &block)
    SemanticLogger.named_tagged(
      filters: (SemanticLogger.named_tags[:filters] || []) + filters,
      &block
    )
  end

  # Filter out messages; if the final value is falsy, nothing will be logged
  def self.filter(log)
    filters = log.named_tags.delete(:filters) || []
    FILTERS.all? { |filter| filter.call(log) } && filters.all? { |filter| filter.call(log) }
  end

  # Used for logging before Rails.Logger is initialized.
  # IE: Can be used before init_logging() is called, and thus before Application is created in application.rb.
  def self.filter_and_format(message, level: :info, name: nil, **kwargs)
    message = message&.strip
    if message.present?
      string_io = StringIO.new
      appender = SemanticLogger::Appender::IO.new(
        string_io,
        level: level, # TODO: Set appender level, or use default: SemanticLogger.default_level?
        formatter: Logging::DEFAULT_FORMATTER,
        filter: lambda(&Logging.method(:filter)),
        application: Rails.application.name
      )
      appender.name = name if name

      appender.send(level, message, **kwargs)

      string_io.string.strip.presence
    else
      message
    end
  end

  def self.with_user_and_request(user, request, &block)
    SemanticLogger.named_tagged(
      usr: user && {
        id: user.id,
        name: user.name.presence,
        email: user.email.presence,
      }.compact,
      request_id: request&.request_id,
      &block
    )
  end

  # Configure JSON logging.
  def self.init_logging(config, formatter: DEFAULT_FORMATTER)
    SemanticLogger.on_log lambda(&Logging.method(:transform))

    # config.rails_semantic_logger.started = false
    # config.rails_semantic_logger.processing = false
    # config.rails_semantic_logger.rendered = false

    config.rails_semantic_logger.appenders do |appenders|
      appenders.add(
        io: $stdout,
        level: config.log_level,
        formatter: formatter,
        filter: lambda(&Logging.method(:filter))
      )
    end
  end

  def self.capture_console(**kwargs)
    old_stdout = Thread.current[:stdout_proxy]
    old_stderr = Thread.current[:stderr_proxy]
    stdout_io = StringIO.new
    stderr_io = StringIO.new

    begin
      Thread.current[:stdout_proxy] = stdout_io
      Thread.current[:stderr_proxy] = stderr_io
      yield
    ensure
      Thread.current[:stdout_proxy] = old_stdout
      Thread.current[:stderr_proxy] = old_stderr
    end

    # TODO: line.start_with?("{") is _very_ JSON specific, so if the logger ever stops being JSON,
    #       then already json-formatted text will be passed through a Rails.logger again
    (stdout_io.string || "").split("\n").map(&:strip).reject(&:empty?).each do |line|
      line.start_with?("{") ? puts(line) : Rails.logger.info(line, stream: "stdout", **kwargs) # rubocop:disable Rails/Output
    end
    (stderr_io.string || "").split("\n").map(&:strip).reject(&:empty?).each do |line|
      line.start_with?("{") ? puts(line) : Rails.logger.warn(line, stream: "stderr", **kwargs) # rubocop:disable Rails/Output
    end
  end
end

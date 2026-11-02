# frozen_string_literal: true

require 'ougai'

module Logging
  # Set current user and request to global for use in logging.
  # See https://stackoverflow.com/a/11670283/200312
  class CurrentContext < ActiveSupport::CurrentAttributes
    attribute :user
    attribute :request

    attribute :fields_to_remove
    attribute :filters
    attribute :unimportant_fields
  end

  class << self
    attr_accessor :default_formatter, :global_fields_to_remove, :global_filters, :global_unimportant_fields
  end

  # This hides the getters and setters from outside the module
  private_class_method :default_formatter=, :global_fields_to_remove, :global_fields_to_remove=
  private_class_method :global_filters, :global_filters=, :global_unimportant_fields, :global_unimportant_fields=

  # Keys removed from each JSON log object (unnecessary fields)
  @global_fields_to_remove = [:pid, :v]

  def self.remove_fields(data)
    @global_fields_to_remove.each { |field| data.delete(field) }
    @fields_to_remove.each { |field| data.delete(field) } if @fields_to_remove
  end

  # Temporarily remove a field
  def self.with_field_removed(field)
    original_fields_to_remove = @fields_to_remove
    @fields_to_remove = @fields_to_remove&.dup || []
    @fields_to_remove << field
    yield
  ensure
    @fields_to_remove = original_fields_to_remove
  end

  class Formatter < Ougai::Formatters::Bunyan
    def format_datetime(time)
      time.utc.iso8601(3)
    end

    def to_level(severity)
      # Log the level name like 'debug' or 'warn' instead of a number like 10,20,30
      severity.downcase.to_sym
    end

    def dump(data)
      Logging.remove_fields(data)
      super(data.compact)
    end
  end

  @default_formatter = Logging::Formatter.new

  # Keys in the JSON log object that don't contribute to whether the message is valid.
  # IE: They are not used to determine if the log object is effectively empty, and thus not logged.
  @global_unimportant_fields = [:module, :stream]

  def self.without_unimportant(data)
    data = data.except(*@global_unimportant_fields)
    @unimportant_fields ? @unimportant_fields.except(*@unimportant_fields) : data
  end

  private_class_method def self.default_filter(data)
    data.delete(:msg) if data && (data[:msg].nil? || data[:msg].to_s.strip.empty?)
    if Logging.without_unimportant(data).blank?
      # Skip if log message is nil or blank, and there are no other properties
      return nil
    end

    data[:request_id] = Logging::CurrentContext.request.request_id if Logging::CurrentContext.request && !data[:request_id]
    data[:user_id] = Logging::CurrentContext.user.id if Logging::CurrentContext.user && !data[:user_id]
    data[:environment] = Rails.env
    data[:thread_id] = Thread.current.object_id

    current_span_context = OpenTelemetry::Trace.current_span&.context
    if current_span_context&.valid?
      data[:trace_id] = current_span_context.hex_trace_id
      data[:span_id] = current_span_context.hex_span_id
    end

    data
  end

  @global_filters = [->(data) { default_filter(data) }]

  def self.add_filter(filter)
    @global_filters << filter
  end

  # Temporarily add a filter
  def self.with_filter(filter)
    original_filters = @filters
    @filters = @filters&.dup || []
    @filters << filter
    yield
  ensure
    @filters = original_filters
  end

  # Filter out and transform messages through each filter; if the final value is falsy, nothing will be logged
  def self.reduce_filters(data)
    data = @global_filters.reduce(data) { |val, lmb| lmb.call(val) }
    @filters ? @filters.reduce(data) { |val, lmb| lmb.call(val) } : data
  end

  def self.create_json_logger(logdev, level, formatter: nil)
    ougai_logger = Ougai::Logger.new(logdev, level: level, formatter: formatter || @default_formatter)
    ougai_logger.default_message = nil
    ougai_logger.before_log = ->(data) { reduce_filters(data).present? }
    ougai_logger
  end

  # Deployed logging configuration.
  #
  # Overridable via RAILS_LOG_LEVEL, defaulting to :debug so a local `development`
  # boot is unchanged. The deployed dev environment sets it to "info".
  #
  # At :debug, ActiveRecord echoes every statement WITH its bound values. On the
  # resque worker that means whole `INSERT INTO contigs` statements including the
  # `sequence` column: measured single log lines up to 484 KB, a 12 KB mean against
  # a 106 B median, and roughly three quarters of all container log bytes in the dev
  # cluster from this one process. Two problems, not one -- the volume, and the fact
  # that sample sequence content is written verbatim into a log stream that ships to
  # an aggregator (and, if enabled, to a third-party log vendor).
  def self.init_logging(config, level: nil, formatter: nil, lograge_enabled: true)
    config.log_level = level || ENV.fetch("RAILS_LOG_LEVEL", "info").to_sym
    config.logger = create_json_logger($stdout, config.log_level, formatter: formatter)
    config.active_record.verbose_query_logs = false
    config.colorize_logging = false

    # This is the _other_ JSON log Formatter that logs after a REST call is made, containing request and response info.
    # {"method":"GET","path":"/up","format":"*/*","controller":"Rails::HealthController","action":"show","status":200,"allocations":239,"duration":5.07,"view":4.68,"db":0.0,"time":12509.095359829,"ddsource":["ruby"],"remote_ip":null,"user_id":null,"params":{}}
    # {"method":"GET","path":"/samples/dimensions.json","format":"json","controller":"SamplesController","action":"dimensions","status":200,"allocations":104589,"duration":350.85,"view":0.22,"db":91.61,"time":12508.690497849,"ddsource":["ruby"],"remote_ip":"1.2.3.4","user_id":789,"params":{"domain":"my_data","format":"json"}}
    config.lograge.enabled = lograge_enabled
    config.lograge.formatter = Lograge::Formatters::Raw.new
    config.lograge.logger = config.logger
    param_filtered = %w[action controller]
    config.lograge.custom_options = lambda do |event|
      {
        ddsource: ["ruby"], # TODO: necessary?
        request_id: event.payload[:request_id],
        remote_ip: event.payload[:remote_ip],
        user_id: event.payload[:user_id],
        params: event.payload[:params].reject { |k| param_filtered.include? k },
      }.compact
    end
    # Suppress messages like: {"method":"GET","path":"/up","format":"*/*","controller":"Rails::HealthController","action":"show","status":200 ...}
    # Suppress messages like: ActionController::RoutingError (No route matches [GET] "..."):
    # config.lograge.ignore_actions = %w[HealthCheck::HealthCheckController#index Rails::HealthController#show ErrorsController#not_found]
    config.lograge.ignore_actions = %w[HealthCheck::HealthCheckController#index Rails::HealthController#show]
    ActiveRecord::Base.logger = config.logger

    config.after_initialize do
      if Rails.logger
        # Extract the core logger if it's wrapped in ActiveSupport::TaggedLogging
        core_logger = Rails.logger.respond_to?(:logger) ? Rails.logger.logger : Rails.logger
        # Also update ActiveRecord's dedicated logger just to be completely safe
        ActiveRecord::Base.logger = core_logger
        # As well as OmniAuth
        OmniAuth.config.logger = core_logger
      end
      ActiveRecord::Migration.verbose = false
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

    stdout_io.rewind
    stderr_io.rewind
    # TODO: line.start_with?("{") is _very_ JSON specific, so if the logger ever stops being JSON (Ougai),
    #       then already json-formatted text will be passed through a Rails.logger again
    (stdout_io.read || "").split("\n").map(&:strip).reject(&:empty?).each do |line|
      line.start_with?("{") ? puts(line) : Rails.logger.info(line, stream: "stdout", **kwargs) # rubocop:disable Rails/Output
    end
    (stderr_io.read || "").split("\n").map(&:strip).reject(&:empty?).each do |line|
      line.start_with?("{") ? puts(line) : Rails.logger.warn(line, stream: "stderr", **kwargs) # rubocop:disable Rails/Output
    end
  end
end

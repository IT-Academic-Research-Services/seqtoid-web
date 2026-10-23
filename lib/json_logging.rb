# frozen_string_literal: true

require 'ougai'

module JsonLogging
  class CurrentContext < ActiveSupport::CurrentAttributes
    attribute :user
    attribute :request
  end

  class CustomizedFormatter < Ougai::Formatters::Bunyan
    alias original_format_datetime format_datetime

    def format_datetime(time)
      # Sometimes time is a float, and needs to be a string or datetime, or format_datetime throws an error
      time = Time.zone.at(time) if time.is_a?(Float)
      original_format_datetime(time)
    end

    def to_level(severity)
      # Log the level name like 'debug' or 'warn' instead of a number like 10,20,30
      severity.downcase.to_sym
    end

    def dump(data)
      # Remove unnecessary extra fields
      # data.delete(:hostname)
      # data.delete(:name)
      data.delete(:pid)
      data.delete(:v)
      super(data.compact)
    end
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
  def self.init_logging(config, level: nil, formatter: nil)
    config.log_level = level || ENV.fetch("RAILS_LOG_LEVEL", "info").to_sym
    config.logger = Ougai::Logger.new(
      $stdout,
      level: config.log_level,
      formatter: formatter || CustomizedFormatter.new
    )
    config.logger.default_message = nil
    config.logger.before_log = lambda do |data|
      data.delete(:msg) if data[:msg].nil? || data[:msg].to_s.strip.empty?
      data[:request_id] = CurrentContext.request.request_id if CurrentContext.request && !data[:request_id]
      data[:user_id] = CurrentContext.user.id if CurrentContext.user && !data[:user_id]
      data[:environment] = Rails.env

      current_span_context = OpenTelemetry::Trace.current_span&.context
      if current_span_context&.valid?
        data[:trace_id] = current_span_context.hex_trace_id
        data[:span_id] = current_span_context.hex_span_id
      end

      true
    end
    config.active_record.verbose_query_logs = false
    config.colorize_logging = false

    # This is the _other_ JSON log Formatter that logs _after_ a REST call is made, containing request and response info.
    # {"method":"GET","path":"/up","format":"*/*","controller":"Rails::HealthController","action":"show","status":200,"allocations":239,"duration":5.07,"view":4.68,"db":0.0,"time":12509.095359829,"ddsource":["ruby"],"remote_ip":null,"user_id":null,"params":{}}
    # {"method":"GET","path":"/samples/dimensions.json","format":"json","controller":"SamplesController","action":"dimensions","status":200,"allocations":104589,"duration":350.85,"view":0.22,"db":91.61,"time":12508.690497849,"ddsource":["ruby"],"remote_ip":"1.2.3.4","user_id":789,"params":{"domain":"my_data","format":"json"}}
    config.lograge.enabled = true
    config.lograge.formatter = Lograge::Formatters::Raw.new
    config.lograge.logger = config.logger
    param_filtered = %w[action controller]
    config.lograge.custom_options = lambda do |event|
      {
        time: event.time, # TODO: Transform to ISO8601
        ddsource: ["ruby"], # TODO: necessary?
        request_id: event.payload[:request_id],
        remote_ip: event.payload[:remote_ip],
        user_id: event.payload[:user_id],
        params: event.payload[:params].reject { |k| param_filtered.include? k },
      }.compact
    end
    config.lograge.ignore_actions = [
      "HealthCheck::HealthCheckController#index",
      "Rails::HealthController#show",
    ]

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
end

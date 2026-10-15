# frozen_string_literal: true

require 'ougai'

module JsonLogging
  class CurrentContext < ActiveSupport::CurrentAttributes
    attribute :user_id
  end

  def self.init_logging(config)
    ougai_logger = Ougai::Logger.new($stdout)
    ougai_logger.level = Ougai::Logger::TRACE
    ougai_logger.before_log = lambda do |data|
      # :request_id,
      data[:user_id] = JsonLogging.CurrentContext.user_id
      data[:environment] = Rails.env
    end
    config.logger = ougai_logger
    config.active_record.verbose_query_logs = false
    config.colorize_logging = false

    # This is the _other_ JSON log Formatter that logs _after_ a REST call is made, containing request and response info.
    # {"method":"GET","path":"/up","format":"*/*","controller":"Rails::HealthController","action":"show","status":200,"allocations":239,"duration":5.07,"view":4.68,"db":0.0,"time":12509.095359829,"ddsource":["ruby"],"remote_ip":null,"user_id":null,"params":{}}
    # {"method":"GET","path":"/samples/dimensions.json","format":"json","controller":"SamplesController","action":"dimensions","status":200,"allocations":104589,"duration":350.85,"view":0.22,"db":91.61,"time":12508.690497849,"ddsource":["ruby"],"remote_ip":"1.2.3.4","user_id":789,"params":{"domain":"my_data","format":"json"}}
    config.lograge.enabled = true
    config.lograge.formatter = Lograge::Formatters::Raw.new
    config.lograge.logger = ougai_logger
    param_filtered = [] # %w[controller action] # TODO: Reset this if too spammy
    config.lograge.custom_options = lambda do |event|
      opt_hash = {
        time: event.time, # TODO: Transform to ISO8601
        ddsource: ["ruby"], # TODO: necessary?
        request_id: event.payload[:request_id],
        remote_ip: event.payload[:remote_ip],
        user_id: event.payload[:user_id],
        params: event.payload[:params].reject { |k| param_filtered.include? k },
      }

      current_span = OpenTelemetry::Trace.current_span
      if current_span&.context&.valid?
        opt_hash[:trace_id] = current_span.context.hex_trace_id
        opt_hash[:span_id] = current_span.context.hex_span_id
      end

      opt_hash.compact
    end
    config.lograge.ignore_actions = ["HealthCheck::HealthCheckController#index"]
    # Rails.application.configure do
    #   config.lograge.enabled = true
    #   config.lograge.formatter = Lograge::Formatters::Json.new # or Lines.new
    # end

    ActiveRecord::Base.logger = ougai_logger

    config.after_initialize do
      if Rails.logger
        # Extract the core logger if it's wrapped in ActiveSupport::TaggedLogging
        core_logger = Rails.logger.respond_to?(:logger) ? Rails.logger.logger : Rails.logger
        # Also update ActiveRecord's dedicated logger just to be completely safe
        ActiveRecord::Base.logger = core_logger
        # As well as OmniAuth
        OmniAuth.config.logger = core_logger
      end
    end
  end
end

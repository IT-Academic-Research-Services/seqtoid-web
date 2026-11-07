if defined?(Shoryuken)
  require "opentelemetry/sdk"
  require "opentelemetry/exporter/otlp"
  require "opentelemetry/instrumentation/all"

  # Shoryuken has no bundled OpenTelemetry instrumentation, so wrap message processing
  # in a CONSUMER span ourselves. The producer here is AWS Step Functions (via
  # EventBridge/SNS), not app code, so these are new root spans rather than a continued
  # trace - still gives per-message worker visibility (latency, errors).
  class OpenTelemetryShoryukenMiddleware
    def call(worker_instance, queue, _sqs_msg, _body)
      tracer = OpenTelemetry.tracer_provider.tracer("shoryuken")
      span_name = "#{worker_instance.class.name} process"
      attributes = {
        OpenTelemetry::SemanticConventions::Trace::MESSAGING_SYSTEM => "aws_sqs",
        OpenTelemetry::SemanticConventions::Trace::MESSAGING_DESTINATION => queue.to_s,
        OpenTelemetry::SemanticConventions::Trace::MESSAGING_OPERATION => "process",
      }
      tracer.in_span(span_name, attributes: attributes, kind: :consumer) do |span|
        yield
      rescue StandardError => e
        span.record_exception(e)
        span.status = OpenTelemetry::Trace::Status.error(e.message)
        raise
      end
    end
  end

  Shoryuken.logger = Rails.logger

  Shoryuken.configure_server do |config|
    # Ensures the server process uses the assigned logger
    config.logger = Rails.logger

    if ENV["OTEL_EXPORTER_OTLP_ENDPOINT"].present?
      config.server_middleware do |chain|
        chain.add OpenTelemetryShoryukenMiddleware
      end
    end
  end

  Shoryuken.configure_client do |config|
    # Ensures the client process uses the assigned logger; this may be unused, but better safe than sorry
    config.logger = Rails.logger
  end
end

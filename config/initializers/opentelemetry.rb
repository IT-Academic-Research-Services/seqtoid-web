# OpenTelemetry (#426) - vendor-neutral tracing for the web app and the Resque /
# Shoryuken workers. Spans are exported over OTLP to the in-cluster ADOT collector
# (cypherid-web-infra terraform/modules/otel-collector), which re-exports to the
# AWS-native backend (X-Ray / CloudWatch). The app stays OTLP-only so the backend can
# be swapped by editing the collector alone.
#
# This is a no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set (mirrors the Sentry
# initializer's DSN gate), so local dev, tests and CI are unaffected. The endpoint is
# injected via chamber (SSM idseq-<env>-web) into every service and points at the
# collector's OTLP HTTP receiver, e.g. http://collector.<env>.otel.internal:4318.
if ENV["OTEL_EXPORTER_OTLP_ENDPOINT"].present?
  require "opentelemetry/sdk"
  require "opentelemetry/exporter/otlp"
  require "opentelemetry/instrumentation/all"

  # All services share one chamber namespace (idseq-<env>-web), so OTEL_SERVICE_NAME
  # can't be injected per process from infra. Self-identify from the running command
  # instead, so web / Resque / Shoryuken traces are distinguishable. An explicit
  # OTEL_SERVICE_NAME still wins if ever set on a task definition.
  otel_cmdline =
    begin
      File.read("/proc/self/cmdline").tr("\0", " ") # argv is NUL-separated
    rescue StandardError
      "#{$PROGRAM_NAME} #{ARGV.join(' ')}"
    end
  otel_service_name = ENV["OTEL_SERVICE_NAME"].presence || case otel_cmdline
                                                           when /shoryuken/ then "seqtoid-shoryuken"
                                                           when /resque/ then "seqtoid-resque"
                                                           else "seqtoid-web"
                                                           end
  Rails.application.config.after_initialize do
    OpenTelemetry::SDK.configure do |c|
      c.logger = Rails.application.config.logger # Log OpenTelemetry initialization messages using the Rails JSON Logger
      c.service_name = otel_service_name
      c.resource = OpenTelemetry::SDK::Resources::Resource.create(
        OpenTelemetry::SemanticConventions::Resource::DEPLOYMENT_ENVIRONMENT => (ENV["RAILS_ENV"] || Rails.env)
      )
      # Auto-instrument whatever is loaded: Rack/Rails/ActiveRecord/Mysql2/Net::HTTP/
      # Faraday/AWS SDK/Redis/Resque/GraphQL. The OTLP exporter is selected automatically
      # from the bundled opentelemetry-exporter-otlp gem.
      c.use_all
    end

    # Shoryuken has no bundled OpenTelemetry instrumentation, so wrap message processing
    # in a CONSUMER span ourselves. The producer here is AWS Step Functions (via
    # EventBridge/SNS), not app code, so these are new root spans rather than a continued
    # trace - still gives per-message worker visibility (latency, errors).
    if defined?(Shoryuken)
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

      Shoryuken.configure_server do |config|
        config.server_middleware do |chain|
          chain.add OpenTelemetryShoryukenMiddleware
        end
      end
    end
  end
end

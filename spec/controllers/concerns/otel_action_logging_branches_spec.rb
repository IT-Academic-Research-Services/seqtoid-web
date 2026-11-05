require "rails_helper"

# Branch sweep for OtelActionLogging (CZID-472). The existing concern spec covers the
# happy paths and the no-PII sanitizer, but several defensive / conditional arms stay
# untaken because the test env runs a no-op tracer with no active span and the tests
# never pass a context resolver:
#   - base_action_attributes: the "trace_id present" arm.
#   - current_otel_trace_id: the valid-span (returns hex) arm and its rescue.
#   - start_user_action_span: the context_proc-present merge arm and its rescue (tracing
#     setup failure returns nil, never raises).
#   - resolve_context: the rescue arm (a raising resolver yields {}).
#   - tag_span_error: the span.nil? early return.
#   - finish_user_action: the rescue arm (a raising span.finish is swallowed).
# All exercised with plain doubles - no controller, no OTLP exporter.
RSpec.describe OtelActionLogging, type: :concern do
  let(:host_class) do
    Class.new do
      include OtelActionLogging
      attr_accessor :current_user, :request, :controller_name, :action_name

      public :base_action_attributes, :current_otel_trace_id, :start_user_action_span,
             :tag_span_error, :finish_user_action, :resolve_context, :emit_action_log
    end
  end

  let(:request_double) { instance_double("ActionDispatch::Request", request_id: "req-1") }

  let(:host) do
    host_class.new.tap do |c|
      c.current_user = nil
      c.request = request_double
      c.controller_name = "projects"
      c.action_name = "create"
    end
  end

  let(:expected_error) { StandardError.new("resolver boom") }

  before do
    allow(LogUtil).to receive(:log_error)
  end

  describe "#base_action_attributes (trace_id arm)" do
    before do
      expect(LogUtil).not_to receive(:log_error)
    end

    it "adds the trace_id attribute when an active trace id is present" do
      allow(host).to receive(:current_otel_trace_id).and_return("deadbeefcafefeed")
      attrs = host.base_action_attributes
      expect(attrs["czid.user_action.trace_id"]).to eq("deadbeefcafefeed")
    end

    it "omits the trace_id attribute when there is no active trace" do
      allow(host).to receive(:current_otel_trace_id).and_return(nil)
      attrs = host.base_action_attributes
      expect(attrs).not_to have_key("czid.user_action.trace_id")
    end
  end

  describe "#current_otel_trace_id" do
    before do
      expect(LogUtil).not_to receive(:log_error)
    end

    it "returns the hex trace id when a valid span is recording" do
      ctx = double("span_context", valid?: true, hex_trace_id: "0123456789abcdef")
      span = double("span", context: ctx)
      allow(OpenTelemetry::Trace).to receive(:current_span).and_return(span)

      expect(host.current_otel_trace_id).to eq("0123456789abcdef")
    end

    it "returns nil (never raises) when reading the current span blows up" do
      allow(OpenTelemetry::Trace).to receive(:current_span).and_raise(StandardError.new("boom"))
      expect(host.current_otel_trace_id).to be_nil
    end
  end

  describe "#resolve_context" do
    it "returns the resolver's value on success" do
      resolver = ->(controller) { { "czid.project.id" => controller.controller_name } }
      expect(host.resolve_context(resolver)).to eq("czid.project.id" => "projects")
      expect(LogUtil).not_to have_received(:log_error)
    end

    it "swallows a raising resolver and returns {}" do
      resolver = ->(_c) { raise expected_error }
      expect(host.resolve_context(resolver)).to eq({})
      expect(LogUtil).to have_received(:log_error).with(
        /context resolver raised.*resolver boom/,
        exception: expected_error
      )
    end
  end

  describe "#start_user_action_span" do
    it "merges the sanitized resolved context when a context_proc is given" do
      resolver = ->(_c) { { "czid.project.id" => 5, "user_email" => "leak@example.com" } }
      host.start_user_action_span("project.create", resolver)

      recorded = host.instance_variable_get(:@user_action_attributes)
      expect(recorded["czid.project.id"]).to eq(5)
      # sensitive key dropped by the sanitizer even on the context path
      expect(recorded).not_to have_key("user_email")
      expect(LogUtil).not_to have_received(:log_error)
    end

    it "returns nil (never raises) when tracer acquisition fails" do
      allow(OpenTelemetry).to receive(:tracer_provider).and_raise(expected_error)

      expect(host.start_user_action_span("project.create", nil)).to be_nil
      expect(LogUtil).to have_received(:log_error).with(
        /tracing setup failed for project.create/,
        exception: expected_error,
        action_name: "project.create",
        attributes: {
          "czid.user_action.action" => "create",
          "czid.user_action.controller" => "projects",
          "czid.user_action.request_id" => request_double.request_id,
        }
      )
    end
  end

  describe "#tag_span_error" do
    it "returns immediately when the span is nil (no active span)" do
      expect { host.tag_span_error(nil, StandardError.new("x")) }.not_to raise_error
      expect(LogUtil).not_to have_received(:log_error)
    end

    it "records the exception and sets an error status on a real span" do
      span = double("span")
      error = ArgumentError.new("bad")
      expect(span).to receive(:record_exception).with(error)
      expect(span).to receive(:status=)

      host.tag_span_error(span, error)

      expect(LogUtil).not_to have_received(:log_error)
    end
  end

  describe "#finish_user_action" do
    it "swallows an exception raised while finishing the span" do
      allow(Rails.logger).to receive(:info)
      host.instance_variable_set(:@user_action_attributes, {})
      span = double("span")
      allow(span).to receive(:finish).and_raise(expected_error)

      expect { host.finish_user_action(span, "project.create", "ok", nil) }.not_to raise_error
      expect(LogUtil).to have_received(:log_error).with(
        /finish failed for project.create/,
        exception: expected_error,
        action_name: "project.create",
        outcome: "ok",
        error_class: nil
      )
    end

    it "emits the log and finishes a healthy span without error" do
      host.instance_variable_set(:@user_action_attributes, { "czid.user_action.user_id" => 1 })
      span = double("span")
      expect(span).to receive(:finish)

      host.finish_user_action(span, "project.create", "ok", nil)
      expect(LogUtil).not_to have_received(:log_error)
    end
  end
end

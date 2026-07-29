require "rails_helper"

# Branch coverage for ExportControl::ScreeningAudit. The sibling screening_audit_spec runs
# with OTLP off, so OpenTelemetry::Trace.current_span always returns the non-recording
# INVALID span: the "span is present AND its context is valid" arms of current_trace_id /
# set_span_attributes never fire, and neither does the "no span at all" arm. These examples
# drive both by substituting the tracer's current span.
RSpec.describe ExportControl::ScreeningAudit do
  let(:valid_context) { double("SpanContext", valid?: true, hex_trace_id: "4bf92f3577b34da6a3ce929d0e0e4736") }
  let(:recording_span) { double("Span", context: valid_context) }

  describe ".current_trace_id" do
    it "returns the hex trace id when a recording span with a valid context exists" do
      allow(OpenTelemetry::Trace).to receive(:current_span).and_return(recording_span)

      expect(described_class.current_trace_id).to eq("4bf92f3577b34da6a3ce929d0e0e4736")
    end

    it "returns nil when there is no current span (safe-navigation nil arm)" do
      allow(OpenTelemetry::Trace).to receive(:current_span).and_return(nil)

      expect(described_class.current_trace_id).to be_nil
    end

    it "returns nil when the current span carries no context" do
      allow(OpenTelemetry::Trace).to receive(:current_span).and_return(double("Span", context: nil))

      expect(described_class.current_trace_id).to be_nil
    end

    it "returns nil rather than raising when the tracer blows up" do
      allow(OpenTelemetry::Trace).to receive(:current_span).and_raise(StandardError, "otel down")

      expect(described_class.current_trace_id).to be_nil
    end
  end

  describe ".set_span_attributes" do
    it "stamps the prefixed event plus every sanitized identifier on the recording span" do
      allow(OpenTelemetry::Trace).to receive(:current_span).and_return(recording_span)
      captured = nil
      allow(recording_span).to receive(:add_attributes) { |attrs| captured = attrs }

      described_class.set_span_attributes("screen.held", "subject_ref" => "User:42", "alert_level" => "red")

      expect(captured).to eq(
        "czid.screening.event" => "screen.held",
        "czid.screening.subject_ref" => "User:42",
        "czid.screening.alert_level" => "red"
      )
    end

    it "is a no-op when there is no current span" do
      allow(OpenTelemetry::Trace).to receive(:current_span).and_return(nil)

      expect(described_class.set_span_attributes("screen.allowed", "subject_ref" => "User:1")).to be_nil
    end

    it "is a no-op when the current span has no context" do
      span = double("Span", context: nil)
      allow(OpenTelemetry::Trace).to receive(:current_span).and_return(span)
      expect(span).not_to receive(:add_attributes)

      expect(described_class.set_span_attributes("screen.allowed", {})).to be_nil
    end

    it "swallows an error raised while writing attributes" do
      allow(OpenTelemetry::Trace).to receive(:current_span).and_return(recording_span)
      allow(recording_span).to receive(:add_attributes).and_raise(StandardError, "span closed")

      expect(described_class.set_span_attributes("screen.error", {})).to be_nil
    end
  end

  describe ".record with a recording span" do
    it "writes the PII-free attributes to the span and still emits the log line" do
      allow(OpenTelemetry::Trace).to receive(:current_span).and_return(recording_span)
      captured = nil
      allow(recording_span).to receive(:add_attributes) { |attrs| captured = attrs }
      allow(Rails.logger).to receive(:info)

      described_class.record("screen.allowed", subject_ref: "User:7", decision: "allowed", name: "Wayne Smith")

      expect(captured).to eq(
        "czid.screening.event" => "screen.allowed",
        "czid.screening.subject_ref" => "User:7",
        "czid.screening.decision" => "allowed"
      )
      expect(Rails.logger).to have_received(:info).with(a_string_including('"screening_event":"screen.allowed"'))
    end

    it "logs an error and does not raise when the whole record path fails" do
      allow(described_class).to receive(:sanitize).and_raise(StandardError, "kaboom")
      allow(Rails.logger).to receive(:error)

      expect { described_class.record("screen.error", subject_ref: "User:9") }.not_to raise_error
      expect(Rails.logger).to have_received(:error).with(a_string_including("[screening_audit] failed to record screen.error"))
    end
  end
end

require "rails_helper"

# Coverage branch sweep for SupportActionLogQuery (CZID-472). The main spec
# (support_action_log_query_spec.rb) drives the happy path with ISO8601 string
# windows and Complete/Failed poll statuses. This file targets the arms it leaves
# untaken, each written to FAIL if the branch is inverted or removed:
#
#   * coerce_epoch: the `when Integer` and `when Time` arms, plus the
#     `rescue ArgumentError -> nil` arm (main spec only feeds valid String windows).
#   * recent_steps: the `return nil if @window_start.nil? || @window_end.nil?` guard
#     (reachable only when a window fails to coerce).
#   * extract_payload: the `parsed.is_a?(Hash) ? parsed : nil` arm, reached by a line
#     whose JSON tail parses to a non-Hash (e.g. a bare number).
RSpec.describe SupportActionLogQuery, type: :service do
  def result_row(timestamp, message)
    [
      instance_double("Aws::CloudWatchLogs::Types::ResultField", field: "@timestamp", value: timestamp),
      instance_double("Aws::CloudWatchLogs::Types::ResultField", field: "@message", value: message),
    ]
  end

  def action_log_line(payload)
    "[user_action] #{payload.to_json}"
  end

  let(:user_id) { 42 }
  let(:correlation_id) { "req-abc-123" }
  let(:client) { instance_double("Aws::CloudWatchLogs::Client") }

  def query(**overrides)
    described_class.new(
      user_id: user_id,
      correlation_id: correlation_id,
      window_start: "2026-07-09T10:00:00Z",
      window_end: "2026-07-09T10:30:00Z",
      log_group: "/seqtoid/support",
      poll_interval: 0,
      **overrides
    )
  end

  before do
    allow(AwsClient).to receive(:[]).with(:cloudwatchlogs).and_return(client)
  end

  describe "coerce_epoch window normalization" do
    it "passes an Integer window through unchanged (the `when Integer` arm)" do
      captured = nil
      allow(client).to receive(:start_query) do |args|
        captured = args
        instance_double("resp", query_id: "q-int")
      end
      allow(client).to receive(:get_query_results)
        .and_return(instance_double("results", status: "Complete", results: []))

      query(window_start: 1_752_055_200, window_end: 1_752_058_800).recent_steps

      # Integer arm returns the value verbatim; if removed, coercion yields nil and
      # the window-nil guard would short-circuit before start_query ran.
      expect(captured[:start_time]).to eq(1_752_055_200)
      expect(captured[:end_time]).to eq(1_752_058_800)
    end

    it "converts a Time window to epoch seconds (the `when Time` arm)" do
      start_t = Time.utc(2026, 7, 9, 10, 0, 0)
      end_t = Time.utc(2026, 7, 9, 10, 30, 0)
      captured = nil
      allow(client).to receive(:start_query) do |args|
        captured = args
        instance_double("resp", query_id: "q-time")
      end
      allow(client).to receive(:get_query_results)
        .and_return(instance_double("results", status: "Complete", results: []))

      query(window_start: start_t, window_end: end_t).recent_steps

      expect(captured[:start_time]).to eq(start_t.to_i)
      expect(captured[:end_time]).to eq(end_t.to_i)
    end

    it "treats an unparseable window as nil and returns nil WITHOUT querying AWS" do
      # Time.iso8601("garbage") raises ArgumentError -> coerce_epoch rescue -> nil,
      # so @window_start is nil and recent_steps must bail before touching the client.
      expect(client).not_to receive(:start_query)
      expect(query(window_start: "garbage").recent_steps).to be_nil
    end
  end

  describe "extract_payload non-Hash JSON tail" do
    it "skips a line whose JSON tail is valid but not a Hash, keeping valid rows" do
      allow(client).to receive(:start_query).and_return(instance_double("resp", query_id: "q-1"))
      rows = [
        # valid JSON, but a bare number -> is_a?(Hash) is false -> row dropped.
        result_row("2026-07-09 10:05:00.000", "#{SupportActionLogQuery::ACTION_LOG_MARKER} 123"),
        result_row("2026-07-09 10:06:00.000",
                   action_log_line("action" => "project.create", "outcome" => "ok")),
      ]
      allow(client).to receive(:get_query_results)
        .and_return(instance_double("results", status: "Complete", results: rows))

      steps = query.recent_steps
      # If the Hash guard were removed, 123["action"] would raise and the whole
      # recent_steps would rescue to nil instead of returning the valid step.
      expect(steps.map { |s| s[:action] }).to eq(["project.create"])
    end
  end
end

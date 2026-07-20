require "rails_helper"

# Coverage branch sweep for ProductUsageAnalytics (CZID-722 Phase 2a). The main spec
# drives ISO8601-string windows and the happy-path rollup. This file targets the arms
# it leaves untaken, each written to FAIL if the branch is inverted or removed:
#
#   * coerce_epoch `when Integer` and `when Time` arms (main spec feeds only Strings).
#   * extract_payload `parsed.is_a?(Hash) ? parsed : nil` arm (JSON tail that parses
#     to a bare number is dropped).
#   * parse_row `return nil if action.nil?` guard (a hash line with no "action" key).
RSpec.describe ProductUsageAnalytics, type: :service do
  def result_row(timestamp, message)
    [
      instance_double("Aws::CloudWatchLogs::Types::ResultField", field: "@timestamp", value: timestamp),
      instance_double("Aws::CloudWatchLogs::Types::ResultField", field: "@message", value: message),
    ]
  end

  def action_line(action:, outcome: "ok", user_id: 1)
    payload = { "czid.user_action.user_id" => user_id, "action" => action, "outcome" => outcome }
    result_row("2026-07-17 12:00:00.000", "[user_action] #{payload.to_json}")
  end

  let(:client) { instance_double("Aws::CloudWatchLogs::Client") }

  def analytics(**overrides)
    described_class.new(
      window_start: "2026-07-17T00:00:00Z",
      window_end: "2026-07-17T23:59:59Z",
      log_group: "/seqtoid/support",
      poll_interval: 0,
      **overrides
    )
  end

  before do
    allow(AwsClient).to receive(:[]).with(:cloudwatchlogs).and_return(client)
  end

  def stub_rows(rows)
    allow(client).to receive(:get_query_results)
      .and_return(instance_double("results", status: "Complete", results: rows))
  end

  describe "coerce_epoch window normalization" do
    it "passes an Integer window through unchanged (the `when Integer` arm)" do
      captured = nil
      allow(client).to receive(:start_query) do |args|
        captured = args
        instance_double("resp", query_id: "q-int")
      end
      stub_rows([])

      analytics(window_start: 1_752_710_400, window_end: 1_752_796_799).overview

      # Integer arm returns the value verbatim; if removed, coercion -> nil and the
      # window-nil guard short-circuits before start_query is called.
      expect(captured[:start_time]).to eq(1_752_710_400)
      expect(captured[:end_time]).to eq(1_752_796_799)
    end

    it "converts a Time window to epoch seconds (the `when Time` arm)" do
      start_t = Time.utc(2026, 7, 17, 0, 0, 0)
      end_t = Time.utc(2026, 7, 17, 23, 59, 59)
      captured = nil
      allow(client).to receive(:start_query) do |args|
        captured = args
        instance_double("resp", query_id: "q-time")
      end
      stub_rows([])

      analytics(window_start: start_t, window_end: end_t).overview

      expect(captured[:start_time]).to eq(start_t.to_i)
      expect(captured[:end_time]).to eq(end_t.to_i)
    end
  end

  describe "row parsing guards" do
    before do
      allow(client).to receive(:start_query).and_return(instance_double("resp", query_id: "q-1"))
    end

    it "drops a line whose JSON tail is valid but not a Hash (the is_a?(Hash) arm)" do
      stub_rows([
                  action_line(action: "project.create", user_id: 1),
                  result_row("2026-07-17 12:00:01.000", "#{ProductUsageAnalytics::ACTION_LOG_MARKER} 123"),
                ])
      # Without the Hash guard, 123["action"] would raise and overview would rescue to
      # nil (nil[:event_count] would then blow up this expectation).
      expect(analytics.overview[:event_count]).to eq(1)
    end

    it "drops a hash line that has no action (the `action.nil?` guard)" do
      no_action = { "czid.user_action.user_id" => 7, "outcome" => "ok" }
      stub_rows([
                  action_line(action: "project.create", user_id: 1),
                  result_row("2026-07-17 12:00:02.000", "#{ProductUsageAnalytics::ACTION_LOG_MARKER} #{no_action.to_json}"),
                ])
      # If the action-nil guard were removed, the actionless line would be counted,
      # making event_count 2.
      expect(analytics.overview[:event_count]).to eq(1)
    end
  end
end

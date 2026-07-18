require "rails_helper"

# CZID-722 (Phase 2a). ProductUsageAnalytics rolls the always-on [user_action] log
# stream up into aggregate, no-PII usage metrics. These specs stub the CloudWatch
# client the same way support_action_log_query_spec does, then pin the rollup: event
# volume, distinct active users, per-action counts + error rate, the truncation flag,
# and -- load-bearing for the privacy tier -- that NO user identifiers reach the output.
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

  let(:window_start) { "2026-07-17T00:00:00Z" }
  let(:window_end) { "2026-07-17T23:59:59Z" }
  let(:client) { instance_double("Aws::CloudWatchLogs::Client") }

  def analytics(**overrides)
    described_class.new(
      window_start: window_start,
      window_end: window_end,
      log_group: "/seqtoid/support",
      poll_interval: 0,
      **overrides
    )
  end

  before do
    allow(AwsClient).to receive(:[]).with(:cloudwatchlogs).and_return(client)
  end

  def stub_rows(rows)
    allow(client).to receive(:start_query).and_return(instance_double("resp", query_id: "q-1"))
    allow(client).to receive(:get_query_results)
      .and_return(instance_double("results", status: "Complete", results: rows))
  end

  describe "gating / inert" do
    it "returns nil and touches no AWS when no log group is configured" do
      expect(AwsClient).not_to receive(:[])
      result = described_class.new(
        window_start: window_start, window_end: window_end, log_group: nil
      ).overview
      expect(result).to be_nil
    end

    it "returns nil when the window cannot be coerced to epoch" do
      expect(analytics(window_start: "not-a-time").overview).to be_nil
    end

    it "returns nil when the query does not complete" do
      allow(client).to receive(:start_query).and_return(instance_double("resp", query_id: "q-1"))
      allow(client).to receive(:get_query_results)
        .and_return(instance_double("results", status: "Failed", results: nil))
      expect(analytics.overview).to be_nil
    end

    it "never raises into the caller -- an AWS error becomes nil" do
      allow(client).to receive(:start_query).and_raise(StandardError, "boom")
      expect { analytics.overview }.not_to raise_error
      expect(analytics.overview).to be_nil
    end
  end

  describe "aggregation" do
    before do
      stub_rows([
                  action_line(action: "sample.bulk_upload", user_id: 1),
                  action_line(action: "sample.bulk_upload", user_id: 2),
                  action_line(action: "bulk_download.create", outcome: "error", user_id: 1),
                  action_line(action: "bulk_download.create", outcome: "ok", user_id: 3),
                ])
    end

    it "counts total events" do
      expect(analytics.overview[:event_count]).to eq(4)
    end

    it "counts DISTINCT active users, not events" do
      # users 1, 2, 3 -> 3 distinct (user 1 appears twice)
      expect(analytics.overview[:active_users]).to eq(3)
    end

    it "breaks down per action with counts and error rate, most-used first" do
      actions = analytics.overview[:actions]
      expect(actions.first).to include(action: "sample.bulk_upload", count: 2, error_count: 0)

      download = actions.find { |a| a[:action] == "bulk_download.create" }
      expect(download).to include(count: 2, error_count: 1)
      expect(download[:error_rate]).to eq(0.5)
    end

    it "reports the query window it covered" do
      overview = analytics.overview
      expect(overview[:window][:start]).to eq(Time.iso8601(window_start).to_i)
      expect(overview[:window][:end]).to eq(Time.iso8601(window_end).to_i)
    end
  end

  describe "privacy: the output carries NO user identifiers" do
    before do
      stub_rows([
                  action_line(action: "project.create", user_id: 4242),
                  action_line(action: "project.mutate", user_id: 4242),
                ])
    end

    it "emits only an aggregate active_users count, never the ids themselves" do
      overview = analytics.overview
      # active_users is a bare count...
      expect(overview[:active_users]).to eq(1)
      # ...and the specific id (4242) appears NOWHERE in the serialized result.
      expect(overview.to_json).not_to include("4242")
    end
  end

  describe "robustness" do
    it "skips lines that are not parseable action-log entries" do
      stub_rows([
                  action_line(action: "project.create", user_id: 1),
                  result_row("2026-07-17 12:00:01.000", "not an action log line"),
                  result_row("2026-07-17 12:00:02.000", "[user_action] {malformed json"),
                ])
      overview = analytics.overview
      expect(overview[:event_count]).to eq(1)
      expect(overview[:actions].length).to eq(1)
    end

    it "flags a truncated window when the line cap is hit" do
      stub_rows([
                  action_line(action: "project.create", user_id: 1),
                  action_line(action: "project.mutate", user_id: 1),
                ])
      expect(analytics(line_limit: 2).overview[:truncated]).to be(true)
    end

    it "does not flag truncation under the cap" do
      stub_rows([action_line(action: "project.create", user_id: 1)])
      expect(analytics(line_limit: 2).overview[:truncated]).to be(false)
    end
  end
end

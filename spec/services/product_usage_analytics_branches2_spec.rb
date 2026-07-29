# frozen_string_literal: true

require "rails_helper"

# Branch sweep #2 for ProductUsageAnalytics. The main spec and the first branches
# spec cover the Integer/Time window arms, the happy-path rollup and two parse
# guards. Remaining untaken arms targeted here:
#
#   coerce_epoch   - the `rescue ArgumentError -> nil` path (unparseable String)
#                    and the implicit case-else (a type that matches no `when`).
#   poll_results   - the terminal Failed/Cancelled/Timeout arm, and the
#                    poll-exhaustion path where no `when` ever matches.
#   parse_row      - `return nil unless message.include?(ACTION_LOG_MARKER)`.
#   extract_payload- the `json_part.empty?` guard (marker with no JSON tail).
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
    allow(client).to receive(:start_query).and_return(instance_double("resp", query_id: "q-1"))
    allow(client).to receive(:get_query_results)
      .and_return(instance_double("results", status: "Complete", results: rows))
  end

  describe "coerce_epoch failure arms" do
    it "returns nil (no AWS call) when a String window is not a parseable timestamp" do
      # Time.iso8601 raises ArgumentError -> rescued to nil -> window guard fires.
      expect(client).not_to receive(:start_query)
      expect(analytics(window_start: "not-a-timestamp").overview).to be_nil
    end

    it "returns nil (no AWS call) for a window value of an unsupported type" do
      # Symbol matches no `when`, so the case expression yields nil.
      expect(client).not_to receive(:start_query)
      expect(analytics(window_end: :whenever).overview).to be_nil
    end
  end

  describe "poll_results terminal + exhaustion arms" do
    before do
      allow(client).to receive(:start_query).and_return(instance_double("resp", query_id: "q-poll"))
    end

    it "returns nil and warns when the query ends Cancelled" do
      allow(client).to receive(:get_query_results)
        .and_return(instance_double("results", status: "Cancelled"))
      expect(Rails.logger).to receive(:warn).with(/ended Cancelled/)

      expect(analytics.overview).to be_nil
    end

    it "returns nil when the query ends Timeout" do
      allow(client).to receive(:get_query_results)
        .and_return(instance_double("results", status: "Timeout"))

      expect(analytics.overview).to be_nil
    end

    it "gives up after max_polls when the query never leaves Running" do
      running = instance_double("results", status: "Running")
      allow(client).to receive(:get_query_results).and_return(running)

      expect(analytics(max_polls: 3).overview).to be_nil
      # Every attempt polls once; none of the terminal `when` arms matched.
      expect(client).to have_received(:get_query_results).exactly(3).times
    end

    it "polls only once when max_polls is 1 (the `attempt < max_polls - 1` false arm)" do
      allow(client).to receive(:get_query_results)
        .and_return(instance_double("results", status: "Running"))

      expect(analytics(max_polls: 1).overview).to be_nil
      expect(client).to have_received(:get_query_results).once
    end
  end

  describe "line-level guards" do
    it "ignores a log line that does not carry the action marker at all" do
      stub_rows([
                  action_line(action: "sample.upload"),
                  result_row("2026-07-17 12:00:05.000", "some unrelated application log line"),
                ])

      overview = analytics.overview
      expect(overview[:event_count]).to eq(1)
      expect(overview[:actions].pluck(:action)).to eq(["sample.upload"])
    end

    it "ignores a marker line with an empty JSON tail" do
      stub_rows([
                  action_line(action: "sample.upload"),
                  result_row("2026-07-17 12:00:06.000", ProductUsageAnalytics::ACTION_LOG_MARKER.to_s),
                ])

      expect(analytics.overview[:event_count]).to eq(1)
    end

    it "counts an error outcome into error_count and error_rate" do
      stub_rows([
                  action_line(action: "sample.upload", outcome: "ok", user_id: 1),
                  action_line(action: "sample.upload", outcome: "error", user_id: 2),
                ])

      overview = analytics.overview
      upload = overview[:actions].detect { |a| a[:action] == "sample.upload" }
      expect(upload[:count]).to eq(2)
      expect(upload[:error_count]).to eq(1)
      expect(upload[:error_rate]).to eq(0.5)
      expect(overview[:active_users]).to eq(2)
    end

    it "does not count a nil user_id toward active_users" do
      stub_rows([
                  action_line(action: "sample.upload", user_id: nil),
                  action_line(action: "sample.upload", user_id: 4),
                ])

      expect(analytics.overview[:active_users]).to eq(1)
    end
  end
end

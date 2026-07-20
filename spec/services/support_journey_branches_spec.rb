require "rails_helper"

# Coverage branch sweep for SupportJourney (CZID-722). The main spec
# (support_journey_spec.rb) exercises sessionization, error anchoring and funnel
# reach/drop over ISO8601 string timestamps. This file targets the arms it leaves
# untaken, each written so it FAILS if the branch is inverted or removed:
#
#   * coerce_time: the `when Integer` and `when Time` arms (main spec only feeds
#     String timestamps).
#   * parse_time_string: the last-resort `Time.zone.parse` arm, reached only by a
#     string that is neither strict ISO8601 nor the CloudWatch "%L %z" form.
#   * evaluate_funnel: the `errored_at ||= stage` "keep the FIRST errored stage"
#     semantics, which needs two errored stages to pin (a single error cannot tell
#     `||=` from `=`).
describe SupportJourney do
  def step(action, at:, outcome: "ok", error_class: nil)
    { at: at, action: action, outcome: outcome, error_class: error_class }.compact
  end

  describe "coerce_time non-String arms" do
    it "computes dwell/duration from Integer epoch timestamps (the `when Integer` arm)" do
      base = 1_752_753_600 # fixed epoch seconds
      steps = [
        step("project.create", at: base),
        step("project.mutate", at: base + 90),
      ]
      session = described_class.from_steps(steps)[:sessions].first
      # If the Integer arm were removed, coerce_time -> nil and dwell/duration go nil.
      expect(session[:steps].last[:since_previous_seconds]).to eq(90)
      expect(session[:duration_seconds]).to eq(90)
    end

    it "computes dwell/duration from Time timestamps (the `when Time` arm)" do
      base = Time.utc(2026, 7, 17, 12, 0, 0)
      steps = [
        step("project.create", at: base),
        step("project.mutate", at: base + 120),
      ]
      session = described_class.from_steps(steps)[:sessions].first
      expect(session[:steps].last[:since_previous_seconds]).to eq(120)
      expect(session[:duration_seconds]).to eq(120)
    end

    it "splits sessions on an Integer-epoch idle gap (arm still drives sessionization)" do
      base = 1_752_753_600
      steps = [
        step("project.create", at: base),
        step("bulk_download.create", at: base + 45 * 60), # 45 min > 30 min default
      ]
      # Only reachable if Integer timestamps parse: otherwise gap is nil and the
      # single-session branch is taken instead.
      expect(described_class.from_steps(steps)[:session_count]).to eq(2)
    end
  end

  describe "parse_time_string last-resort Time.zone.parse arm" do
    it "parses a space-separated timestamp with NO milliseconds via the final fallback" do
      # "2026-07-17 12:00:00" (no 'T', no '.mmm') is rejected by BOTH Time.iso8601
      # and the strptime("%Y-%m-%d %H:%M:%S.%L %z") form, so it can only be parsed
      # by the last-resort Time.zone.parse. Removing that arm -> nil dwell.
      steps = [
        step("project.create", at: "2026-07-17 12:00:00"),
        step("project.mutate", at: "2026-07-17 12:00:30"),
      ]
      session = described_class.from_steps(steps)[:sessions].first
      expect(session[:steps].last[:since_previous_seconds]).to eq(30)
    end
  end

  describe "funnel errored_at keeps the FIRST errored stage" do
    it "does not overwrite errored_at when a later stage also errors (the `||=`)" do
      steps = [
        step("sample.bulk_upload", at: "2026-07-17T12:00:00Z", outcome: "error", error_class: "First"),
        step("bulk_download.create", at: "2026-07-17T12:01:00Z", outcome: "error", error_class: "Second"),
      ]
      funnel = described_class.from_steps(steps)[:funnels].find { |f| f[:name] == "sample_to_download" }
      # `||=` must keep the first errored stage; `=` would report bulk_download.create.
      expect(funnel[:errored_at]).to eq("sample.bulk_upload")
      expect(funnel[:completed]).to be(true)
    end
  end
end

require "rails_helper"

# Second branch-coverage sweep for SupportJourney. support_journey_spec.rb and
# support_journey_branches_spec.rb between them cover the String/Integer/Time
# timestamp arms, sessionization and funnel reach. This file targets the three
# arms they still leave untaken:
#
#   * evaluate_funnel's `next if stage.nil?` guard -- reached only when the step
#     trail continues AFTER every funnel stage has already been consumed.
#   * coerce_time's implicit `else` (a value that is neither Time, Integer nor
#     String falls through the case and yields nil).
#   * parse_time_string's `return nil if s.empty?` guard -- a whitespace-only
#     timestamp string.
#
# Spec-only. No app code touched.
describe SupportJourney do
  def step(action, at:, outcome: "ok", error_class: nil)
    { at: at, action: action, outcome: outcome, error_class: error_class }.compact
  end

  describe "evaluate_funnel exhausted-stages guard" do
    it "ignores trailing steps once every funnel stage has been reached" do
      base = Time.utc(2026, 7, 17, 9, 0, 0)
      steps = [
        step("sample.bulk_upload", at: base),
        step("bulk_download.create", at: base + 60),
        # Third step arrives with next_index already past the end of the stage
        # list -> stages[2] is nil -> the guard skips it.
        step("sample.bulk_upload", at: base + 120),
      ]

      funnel = described_class.from_steps(steps)[:funnels]
                              .find { |f| f[:name] == "sample_to_download" }

      expect(funnel).to be_present
      expect(funnel[:completed]).to be(true)
      # Without the nil guard the trailing step would push reached past the
      # stage list (or blow up indexing); reached must stay exactly the stages.
      expect(funnel[:reached]).to eq(%w[sample.bulk_upload bulk_download.create])
      expect(funnel[:furthest_stage]).to eq("bulk_download.create")
      expect(funnel).not_to have_key(:dropped_after)
    end
  end

  describe "coerce_time fall-through for unsupported types" do
    it "yields no dwell or duration when timestamps are neither Time, Integer nor String" do
      steps = [
        step("project.create", at: 1_752_753_600.0), # Float: matches no `when`
        step("project.mutate", at: 1_752_753_690.0),
      ]

      session = described_class.from_steps(steps)[:sessions].first

      # coerce_time returns nil for both, so gap and span are unknown, and the
      # unparseable steps stay in ONE session (the conservative behaviour).
      expect(session[:steps].last).not_to have_key(:since_previous_seconds)
      expect(session).not_to have_key(:duration_seconds)
      expect(described_class.from_steps(steps)[:session_count]).to eq(1)
    end

    it "still records the steps themselves when the timestamps are unusable" do
      steps = [step("project.create", at: 1_752_753_600.0)]
      journey = described_class.from_steps(steps)

      expect(journey[:step_count]).to eq(1)
      expect(journey[:sessions].first[:entry_action]).to eq("project.create")
    end
  end

  describe "parse_time_string blank-string guard" do
    it "treats a whitespace-only timestamp as unparseable rather than raising" do
      steps = [
        step("project.create", at: "   "),
        step("project.mutate", at: "\t\n"),
      ]

      journey = described_class.from_steps(steps)
      session = journey[:sessions].first

      expect(journey[:session_count]).to eq(1)
      expect(session[:steps].last).not_to have_key(:since_previous_seconds)
      expect(session).not_to have_key(:duration_seconds)
    end

    it "does not blank-guard a real timestamp that merely has surrounding whitespace" do
      steps = [
        step("project.create", at: "  2026-07-17T09:00:00Z  "),
        step("project.mutate", at: "  2026-07-17T09:01:00Z  "),
      ]

      session = described_class.from_steps(steps)[:sessions].first

      expect(session[:steps].last[:since_previous_seconds]).to eq(60)
    end
  end
end

require 'rails_helper'

# CZID-597 -- ScreeningResult evidence model. transstatus is the PRIMARY release/hold signal; alert_level
# is stored severity. Fail-closed: anything that is not exactly "Passed" holds.
RSpec.describe ScreeningResult, type: :model do
  describe "validations" do
    it "is valid with a known alert level" do
      expect(build(:screening_result)).to be_valid
    end

    it "rejects an unknown alert level" do
      expect(build(:screening_result, alert_level: "chartreuse")).not_to be_valid
    end

    it "requires subject_ref and screened_at" do
      expect(build(:screening_result, subject_ref: nil)).not_to be_valid
      expect(build(:screening_result, screened_at: nil)).not_to be_valid
    end
  end

  describe "#passed? / #hold_required?" do
    it "passes on an exact Passed transstatus" do
      expect(build(:screening_result, transstatus: ScreeningResult::TRANSSTATUS_PASSED)).to be_passed
    end

    it "holds on On Hold-RPS even with a clean alert level (explicit vendor on-hold wins)" do
      res = build(:screening_result, transstatus: ScreeningResult::TRANSSTATUS_ON_HOLD,
                                      alert_level: ScreeningResult::ALERT_NOMATCH)
      expect(res).to be_hold_required
      expect(res).not_to be_passed
    end

    # The SearchEntity screen this app makes returns its verdict in alert_level and leaves transstatus
    # blank; a clean no-match must PASS (the old transstatus-only logic held every clean subject).
    it "passes on a clean/allow-listed alert level when transstatus is blank" do
      [ScreeningResult::ALERT_NOMATCH, ScreeningResult::ALERT_WL, ScreeningResult::ALERT_AL].each do |lvl|
        res = build(:screening_result, transstatus: nil, alert_level: lvl)
        expect(res).to be_passed, "expected #{lvl} with blank transstatus to pass"
      end
    end

    it "fail-closed: holds on a match or unknown alert level when transstatus is blank" do
      expect(build(:screening_result, transstatus: nil, alert_level: ScreeningResult::ALERT_YELLOW)).to be_hold_required
      expect(build(:screening_result, transstatus: nil, alert_level: ScreeningResult::ALERT_RED)).to be_hold_required
      expect(build(:screening_result, transstatus: nil, alert_level: ScreeningResult::ALERT_TRIPLE_RED)).to be_hold_required
    end

    it "holds a clean no-match when a sanctioned-jurisdiction association forces effective RED" do
      res = build(:screening_result, transstatus: nil, alert_level: ScreeningResult::ALERT_NOMATCH,
                                      jurisdiction_risk: true)
      expect(res).to be_hold_required
    end
  end

  describe "#alert_allowed? (severity helper)" do
    it "is true for nomatch/wl/al and false for the red/yellow levels" do
      expect(build(:screening_result, alert_level: ScreeningResult::ALERT_NOMATCH).alert_allowed?).to be(true)
      expect(build(:screening_result, :wl).alert_allowed?).to be(true)
      expect(build(:screening_result, :al).alert_allowed?).to be(true)
      expect(build(:screening_result, :yellow).alert_allowed?).to be(false)
      expect(build(:screening_result, :triple_red).alert_allowed?).to be(false)
    end
  end

  describe ".latest_for" do
    it "returns the most recent screen for a subject" do
      old = create(:screening_result, subject_ref: "user:42", screened_at: 2.days.ago)
      newest = create(:screening_result, subject_ref: "user:42", screened_at: 1.hour.ago)
      create(:screening_result, subject_ref: "user:99", screened_at: 1.minute.ago)

      expect(ScreeningResult.latest_for("user:42")).to eq(newest)
      expect(ScreeningResult.latest_for("user:42")).not_to eq(old)
      expect(ScreeningResult.latest_for("user:nobody")).to be_nil
    end
  end
end

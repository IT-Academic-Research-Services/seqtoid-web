require 'rails_helper'

# CZID-597 -- Hold model. A hold gates the protected action until released; active == released_at is nil.
RSpec.describe Hold, type: :model do
  describe "validations" do
    it "is valid with a known reason" do
      expect(build(:hold)).to be_valid
    end

    it "rejects an unknown reason" do
      expect(build(:hold, reason: "because")).not_to be_valid
    end

    it "requires subject_ref" do
      expect(build(:hold, subject_ref: nil)).not_to be_valid
    end

    it "allows a nil screening_result (fail-closed error/timeout holds have no screen row)" do
      expect(build(:hold, :error)).to be_valid
      expect(build(:hold, :error).screening_result).to be_nil
    end
  end

  describe "scopes" do
    it ".active returns only un-released holds; .released the rest" do
      active = create(:hold)
      released = create(:hold, :released)

      expect(Hold.active).to include(active)
      expect(Hold.active).not_to include(released)
      expect(Hold.released).to contain_exactly(released)
    end

    it ".for_subject filters by subject_ref" do
      mine = create(:hold, subject_ref: "user:7")
      create(:hold, subject_ref: "user:8")
      expect(Hold.for_subject("user:7")).to contain_exactly(mine)
    end
  end

  describe "#release!" do
    it "sets released_at and flips active?" do
      hold = create(:hold)
      expect(hold).to be_active
      hold.release!
      expect(hold).not_to be_active
      expect(hold.released_at).to be_present
    end

    it "records the terminal IM verdict as a durable adjudication (SMP-1253)" do
      hold = create(:hold)
      hold.release!(resolution_status: "Cleared", incident_id: "IM-42")

      expect(hold.reload).not_to be_active
      expect(hold).to be_adjudicated
      expect(hold.disposition).to eq(Hold::DISPOSITION_RELEASED)
      expect(hold.resolution_status).to eq("Cleared")
      expect(hold.incident_id).to eq("IM-42")
      expect(hold.resolved_at).to be_present
    end

    it "is idempotent -- keeps the first release timestamp" do
      hold = create(:hold, :released)
      first = hold.released_at
      hold.release!(at: 1.day.from_now)
      expect(hold.reload.released_at).to be_within(1.second).of(first)
    end
  end

  describe "#deny!" do
    it "records a terminal deny durably WITHOUT releasing the hold" do
      hold = create(:hold)
      hold.deny!(resolution_status: "True Hit", incident_id: "IM-99")

      expect(hold.reload).to be_active # stays in force -- a deny never releases
      expect(hold).to be_adjudicated
      expect(hold.disposition).to eq(Hold::DISPOSITION_DENIED)
      expect(hold.resolution_status).to eq("True Hit")
      expect(hold.incident_id).to eq("IM-99")
      expect(hold.resolved_at).to be_present
    end

    it "is idempotent -- only the first terminal verdict is recorded" do
      hold = create(:hold)
      hold.deny!(resolution_status: "True Hit", incident_id: "IM-99")
      first = hold.reload.resolved_at
      hold.deny!(at: 1.day.from_now, resolution_status: "True Hit", incident_id: "IM-different")

      expect(hold.reload.resolved_at).to be_within(1.second).of(first)
      expect(hold.incident_id).to eq("IM-99")
    end
  end

  describe "association" do
    it "belongs to the screening_result that triggered it" do
      sr = create(:screening_result, :red)
      hold = create(:hold, screening_result: sr, subject_ref: sr.subject_ref)
      expect(hold.screening_result).to eq(sr)
      expect(sr.holds).to include(hold)
    end
  end
end

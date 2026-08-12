require "rails_helper"

# Supported-version FLOOR: a catalogued version older than its workflow's oldest supported version is
# LOCKED (view-only). These specs pin the comparison and the per-row predicate the selector, the
# dispatch gate, and the lock seed all rely on.
RSpec.describe WorkflowVersion, type: :model do
  describe ".below_floor?" do
    it "is true for a version strictly below the floor" do
      expect(described_class.below_floor?("6.11.0", "7.0.0")).to be(true)
    end

    it "is false at the floor and above it" do
      expect(described_class.below_floor?("7.0.0", "7.0.0")).to be(false)
      expect(described_class.below_floor?("8.3.15", "7.0.0")).to be(false)
    end

    it "orders segment-wise, not lexically (6.9 < 7.0 even though '6' < '7' only by luck here)" do
      # The real trap version_sort_key exists for: 6.9.0 vs 7.0.0, and 6.9.0 vs 6.10.0.
      expect(described_class.below_floor?("6.9.0", "6.10.0")).to be(true)
      expect(described_class.below_floor?("6.10.0", "6.9.0")).to be(false)
    end

    it "treats a commit-tagged prerelease of the floor's predecessor as below the floor" do
      expect(described_class.below_floor?("6.9.0-b9b4ab1", "7.0.0")).to be(true)
    end

    it "is false when there is no floor" do
      expect(described_class.below_floor?("1.0.0", nil)).to be(false)
    end

    it "is false for a non-version identifier (e.g. an alignment-config name), which has no version line" do
      expect(described_class.below_floor?("ncbi_2024-02-06_v1", "7.0.0")).to be(false)
    end
  end

  describe "#below_supported_floor? / #locked?" do
    it "locks a short-read-mngs version below the 7.0.0 floor" do
      wv = create(:workflow_version, workflow: "short-read-mngs", version: "6.11.0")
      expect(wv.below_supported_floor?).to be(true)
      expect(wv.locked?).to be(true)
    end

    it "does not lock a short-read-mngs version at or above the floor" do
      expect(create(:workflow_version, workflow: "short-read-mngs", version: "7.0.0").locked?).to be(false)
      expect(create(:workflow_version, workflow: "short-read-mngs", version: "8.3.15").locked?).to be(false)
    end

    it "does not lock a workflow that has no floor set" do
      # consensus-genome has no SUPPORTED_VERSION_FLOORS entry -> unconstrained, unchanged behaviour.
      expect(create(:workflow_version, workflow: "consensus-genome", version: "1.0.0").locked?).to be(false)
    end

    it "leaves the runnable flag itself untouched -- locking is enforced at the consult points, " \
       "not by rewriting runnable on the row" do
      wv = create(:workflow_version, workflow: "short-read-mngs", version: "6.11.0", runnable: true)
      expect(wv.reload.runnable).to be(true)
      expect(wv.below_supported_floor?).to be(true)
    end
  end

  describe ".supported_floor" do
    it "returns the floor for a workflow that has one" do
      expect(described_class.supported_floor("short-read-mngs")).to eq("7.0.0")
    end

    it "returns nil for a workflow with no floor" do
      expect(described_class.supported_floor("consensus-genome")).to be_nil
    end
  end
end

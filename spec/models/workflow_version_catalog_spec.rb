require "rails_helper"

# CZID-973 -- workflow_versions as a reproducible catalog.
RSpec.describe WorkflowVersion, type: :model do
  describe "engines" do
    it "defaults to swipe so existing dispatch behaviour is unchanged" do
      wv = create(:workflow_version, workflow: "consensus-genome", version: "3.5.5")

      expect(wv.reload.engines).to eq([described_class::ENGINE_SWIPE])
      expect(wv.runs_on?(described_class::ENGINE_SWIPE)).to be true
      expect(wv.runs_on?(described_class::ENGINE_K8S)).to be false
    end

    it "accepts an explicit engine list" do
      wv = create(:workflow_version, workflow: "amr", version: "1.4.2",
                                     engines: [described_class::ENGINE_SWIPE, described_class::ENGINE_K8S])

      expect(wv.runs_on?(described_class::ENGINE_K8S)).to be true
    end

    it "rejects an unknown engine rather than silently storing it" do
      wv = build(:workflow_version, workflow: "amr", version: "9.9.9", engines: ["nomad"])

      expect(wv).not_to be_valid
      expect(wv.errors.full_messages.join).to match(/unknown engines: nomad/)
    end

    it "falls back to the default when handed an empty list" do
      # A row with no engines could not be dispatched anywhere, which is never the intent.
      wv = create(:workflow_version, workflow: "amr", version: "1.0.0", engines: [])

      expect(wv.reload.engines).to eq([described_class::ENGINE_SWIPE])
    end

    describe ".runnable_on" do
      it "returns only versions opted in to the engine, and only runnable ones" do
        swipe_only = create(:workflow_version, workflow: "amr", version: "1.0.0")
        k8s = create(:workflow_version, workflow: "amr", version: "1.1.0",
                                        engines: [described_class::ENGINE_SWIPE, described_class::ENGINE_K8S])
        create(:workflow_version, workflow: "amr", version: "1.2.0", runnable: false,
                                  engines: [described_class::ENGINE_SWIPE, described_class::ENGINE_K8S])

        expect(described_class.runnable_on(described_class::ENGINE_K8S)).to eq([k8s])
        expect(described_class.runnable_on(described_class::ENGINE_SWIPE)).to include(swipe_only, k8s)
      end
    end
  end

  describe "provenance" do
    let(:digest) { "sha256:#{'a' * 64}" }
    let(:checksum) { "b" * 64 }

    it "reports reproducible? only once both the digest and the checksum are recorded" do
      bare = create(:workflow_version, workflow: "amr", version: "1.0.0")
      expect(bare.reproducible?).to be false

      partial = create(:workflow_version, workflow: "amr", version: "1.1.0", image_digest: digest)
      expect(partial.reproducible?).to be false

      published = create(:workflow_version, workflow: "amr", version: "1.2.0",
                                            image_digest: digest, wdl_checksum: checksum)
      expect(published.reproducible?).to be true
    end

    it "rejects a malformed image digest" do
      expect(build(:workflow_version, workflow: "amr", version: "1.0.0", image_digest: "latest")).not_to be_valid
      expect(build(:workflow_version, workflow: "amr", version: "1.0.0", image_digest: "sha256:xyz")).not_to be_valid
    end

    it "rejects a malformed wdl checksum" do
      expect(build(:workflow_version, workflow: "amr", version: "1.0.0", wdl_checksum: "nope")).not_to be_valid
    end

    it "rejects an unknown tier" do
      expect(build(:workflow_version, workflow: "amr", version: "1.0.0", tier: "tier-1")).not_to be_valid
      expect(build(:workflow_version, workflow: "amr", version: "1.0.0", tier: described_class::TIER_LAZY)).to be_valid
    end

    # Rows created before the publisher existed (seeded, or made by the CZID-982 reconciliation)
    # must keep working and must not claim provenance they never had.
    it "allows rows with no provenance at all" do
      wv = create(:workflow_version, workflow: "short-read-mngs", version: "8.3.15")

      expect(wv).to be_valid
      expect(wv.image_digest).to be_nil
      expect(wv.published_at).to be_nil
      expect(wv.tier).to be_nil
      expect(wv.reproducible?).to be false
    end
  end
end

require "rails_helper"

# CZID-973 -- the register endpoint records the provenance the publisher computes, and treats
# re-registration as enrichment rather than overwrite.
RSpec.describe WorkflowVersionsController, type: :controller do
  let(:token) { "s3cr3t-publisher-token" }
  let(:digest) { "sha256:#{'a' * 64}" }
  let(:other_digest) { "sha256:#{'c' * 64}" }
  let(:checksum) { "b" * 64 }

  around do |example|
    original = ENV["WORKFLOW_PUBLISHER_TOKEN"]
    ENV["WORKFLOW_PUBLISHER_TOKEN"] = token
    example.run
    ENV["WORKFLOW_PUBLISHER_TOKEN"] = original
  end

  before { request.headers["X-Workflow-Publisher-Token"] = token }

  def full_manifest_params(overrides = {})
    {
      workflow: "consensus-genome",
      version: "3.5.5",
      image_digest: digest,
      wdl_checksum: checksum,
      published_at: "2026-08-05T00:00:00Z",
      tier: WorkflowVersion::TIER_FULL,
      engines: [WorkflowVersion::ENGINE_SWIPE],
      notes: "published by CI",
    }.merge(overrides)
  end

  describe "recording provenance" do
    it "persists everything the publisher's manifest carries" do
      post :create, params: full_manifest_params

      expect(response).to have_http_status(:created)
      wv = WorkflowVersion.find_by(workflow: "consensus-genome", version: "3.5.5")
      expect(wv.image_digest).to eq(digest)
      expect(wv.wdl_checksum).to eq(checksum)
      expect(wv.tier).to eq(WorkflowVersion::TIER_FULL)
      expect(wv.engines).to eq([WorkflowVersion::ENGINE_SWIPE])
      expect(wv.notes).to eq("published by CI")
      expect(wv.published_at).to be_present
      expect(wv.reproducible?).to be true
    end

    it "still accepts a bare registration with no provenance" do
      post :create, params: { workflow: "amr", version: "1.4.2" }

      expect(response).to have_http_status(:created)
      wv = WorkflowVersion.find_by(workflow: "amr", version: "1.4.2")
      expect(wv.engines).to eq([WorkflowVersion::ENGINE_SWIPE])
      expect(wv.reproducible?).to be false
    end

    it "rejects a malformed digest rather than recording it" do
      post :create, params: full_manifest_params(image_digest: "latest")

      expect(response).to have_http_status(:unprocessable_content)
      expect(WorkflowVersion.where(workflow: "consensus-genome").count).to eq(0)
    end

    it "rejects an unknown tier" do
      post :create, params: full_manifest_params(tier: "tier-1")

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "rejects an unknown engine" do
      post :create, params: full_manifest_params(engines: ["nomad"])

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "rejects an unparseable published_at" do
      post :create, params: full_manifest_params(published_at: "not-a-time")

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "re-registration" do
    it "enriches a row that predates the publisher instead of rejecting it" do
      # Exactly the shape the CZID-982 reconciliation created: catalogued, no provenance.
      existing = create(:workflow_version, workflow: "consensus-genome", version: "3.5.5")
      expect(existing.image_digest).to be_nil

      post :create, params: full_manifest_params

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["status"]).to eq("enriched")
      expect(existing.reload.image_digest).to eq(digest)
      expect(existing.reload.reproducible?).to be true
    end

    it "is a no-op when the same version is republished unchanged" do
      post :create, params: full_manifest_params
      post :create, params: full_manifest_params

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["status"]).to eq("already registered")
      expect(WorkflowVersion.where(workflow: "consensus-genome", version: "3.5.5").count).to eq(1)
    end

    it "refuses a different digest for an already-published version" do
      post :create, params: full_manifest_params

      post :create, params: full_manifest_params(image_digest: other_digest)

      expect(response).to have_http_status(:conflict)
      # The recorded provenance is preserved, not overwritten.
      expect(WorkflowVersion.find_by(workflow: "consensus-genome", version: "3.5.5").image_digest).to eq(digest)
    end

    it "never overwrites provenance that is already recorded" do
      create(:workflow_version, workflow: "consensus-genome", version: "3.5.5",
                                image_digest: digest, notes: "original note")

      post :create, params: full_manifest_params(notes: "different note")

      wv = WorkflowVersion.find_by(workflow: "consensus-genome", version: "3.5.5")
      expect(wv.notes).to eq("original note")
    end
  end

  describe "auth" do
    it "still denies an unauthenticated request carrying full provenance" do
      request.headers["X-Workflow-Publisher-Token"] = "wrong"

      post :create, params: full_manifest_params

      expect(response).to have_http_status(:unauthorized)
      expect(WorkflowVersion.where(workflow: "consensus-genome").count).to eq(0)
    end
  end
end

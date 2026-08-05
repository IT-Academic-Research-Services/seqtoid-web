require "rails_helper"

# CZID-975 -- the catalog the upload flow's version dropdown reads.
RSpec.describe WorkflowVersionsController, type: :controller do
  create_users

  let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }

  def listed_versions
    JSON.parse(response.body)["versions"]
  end

  # CZID-994 -- the dropdown is behind a feature flag; these cover the behavior once it is on. The
  # dark default has its own context at the bottom.
  before { AppConfigHelper.set_app_config(AppConfig::ENABLE_VERSIONED_PIPELINE_SELECTION, "1") }

  context "as a signed-in non-admin user" do
    before { sign_in @joe }

    it "returns the catalogued versions newest first, by numeric segment" do
      # A string sort would put 8.3.9 above 8.3.15 -- the CZID-972 ordering is what makes the
      # dropdown offer the right version first.
      ["8.3.9", "8.3.15", "8.2.1"].each { |v| create(:workflow_version, workflow: workflow, version: v) }

      get :index, params: { workflow: workflow }

      expect(response).to have_http_status(:ok)
      expect(listed_versions.pluck("version")).to eq(["8.3.15", "8.3.9", "8.2.1"])
    end

    it "omits versions that cannot be dispatched" do
      create(:workflow_version, workflow: workflow, version: "8.3.15")
      create(:workflow_version, workflow: workflow, version: "8.0.0", runnable: false)

      get :index, params: { workflow: workflow }

      # Offering a non-runnable version would only produce a failed upload -- the dispatch path
      # refuses it.
      expect(listed_versions.pluck("version")).to eq(["8.3.15"])
    end

    it "returns deprecated versions but flags them" do
      create(:workflow_version, workflow: workflow, version: "8.3.15")
      create(:workflow_version, workflow: workflow, version: "8.1.0", deprecated: true, notes: "no longer patched")

      get :index, params: { workflow: workflow }

      deprecated = listed_versions.find { |v| v["version"] == "8.1.0" }
      expect(deprecated["deprecated"]).to be true
      expect(deprecated["notes"]).to eq("no longer patched")
      expect(listed_versions.find { |v| v["version"] == "8.3.15" }["deprecated"]).to be false
    end

    it "scopes to the requested workflow" do
      create(:workflow_version, workflow: workflow, version: "8.3.15")
      create(:workflow_version, workflow: "consensus-genome", version: "3.5.5")

      get :index, params: { workflow: "consensus-genome" }

      expect(listed_versions.pluck("version")).to eq(["3.5.5"])
    end

    it "returns an empty list rather than an error for an uncatalogued workflow" do
      get :index, params: { workflow: "long-read-mngs" }

      expect(response).to have_http_status(:ok)
      expect(listed_versions).to eq([])
    end

    it "rejects a malformed workflow name" do
      get :index, params: { workflow: "../etc/passwd" }

      expect(response).to have_http_status(:unprocessable_entity)
    end

    it "also serves the NCBI index catalog, which uses dates rather than semver" do
      create(:workflow_version, workflow: AlignmentConfig::NCBI_INDEX, version: "2021-01-22")
      create(:workflow_version, workflow: AlignmentConfig::NCBI_INDEX, version: "2026-07-09")

      get :index, params: { workflow: AlignmentConfig::NCBI_INDEX }

      expect(listed_versions.pluck("version")).to eq(["2026-07-09", "2021-01-22"])
    end
  end

  context "when signed out" do
    it "does not serve the catalog" do
      create(:workflow_version, workflow: workflow, version: "8.3.15")

      get :index, params: { workflow: workflow }

      expect(response).not_to have_http_status(:ok)
    end
  end

  # CZID-994 -- with the feature dark the endpoint stays well-formed but offers nothing, so the
  # dropdown (opt-in on availableVersions.length > 0) renders exactly as it did before the feature.
  context "with the feature flag off" do
    before { sign_in @joe }

    it "serves an empty list rather than an error" do
      AppConfigHelper.set_app_config(AppConfig::ENABLE_VERSIONED_PIPELINE_SELECTION, "")
      create(:workflow_version, workflow: workflow, version: "8.3.15")

      get :index, params: { workflow: workflow }

      # 200 with nothing to choose, NOT a 404 the frontend would have to special-case.
      expect(response).to have_http_status(:ok)
      expect(listed_versions).to eq([])
      expect(JSON.parse(response.body)["workflow"]).to eq(workflow)
    end

    it "still rejects a malformed workflow name while dark" do
      AppConfigHelper.set_app_config(AppConfig::ENABLE_VERSIONED_PIPELINE_SELECTION, "")

      get :index, params: { workflow: "not a workflow!" }

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end
end

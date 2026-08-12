require "rails_helper"

# The dispatch gate must refuse a version below the workflow's supported floor (LOCKED / view-only),
# with a distinct typed error so the upload path can surface a clean "locked" message rather than a
# stuck rollback. short-read-mngs floor = 7.0.0.
RSpec.describe VersionRetrievalService, type: :service do
  let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }
  let(:project) { create(:project) }

  describe "an explicit user selection of a below-floor version" do
    it "raises WorkflowVersionLockedError, not a generic not-runnable/deprecated error" do
      # Catalogued and runnable -- locking is the floor, independent of the runnable flag.
      create(:workflow_version, workflow: workflow, version: "6.11.0", runnable: true)

      expect { VersionRetrievalService.call(project.id, workflow, "6.11.0") }
        .to raise_error(ErrorHelper::VersionControlErrors::WorkflowVersionLockedError, /locked/)
    end

    it "still resolves a supported version at or above the floor" do
      create(:workflow_version, workflow: workflow, version: "8.3.15")

      expect(VersionRetrievalService.call(project.id, workflow, "8.3.15")).to eq("8.3.15")
    end

    it "still resolves the floor version itself" do
      create(:workflow_version, workflow: workflow, version: "7.0.0")

      expect(VersionRetrievalService.call(project.id, workflow, "7.0.0")).to eq("7.0.0")
    end
  end

  describe "the default path resolving a below-floor version" do
    it "refuses it as locked" do
      AppConfigHelper.set_app_config(
        format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: workflow), "6.11.0"
      )
      create(:workflow_version, workflow: workflow, version: "6.11.0", runnable: true)

      expect { VersionRetrievalService.call(project.id, workflow) }
        .to raise_error(ErrorHelper::VersionControlErrors::WorkflowVersionLockedError, /locked/)
    end
  end

  describe "a workflow with no floor" do
    it "is unaffected -- an old consensus-genome version still resolves" do
      cg = WorkflowRun::WORKFLOW[:consensus_genome]
      create(:workflow_version, workflow: cg, version: "1.0.0")

      expect(VersionRetrievalService.call(project.id, cg, "1.0.0")).to eq("1.0.0")
    end
  end
end

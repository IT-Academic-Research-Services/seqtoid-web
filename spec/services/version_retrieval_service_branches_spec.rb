require "rails_helper"

# Coverage branch sweep for VersionRetrievalService. The main spec exercises the
# "no pin -> latest default", "pin -> latest for prefix", and the deprecated /
# not-runnable / not-found raise paths. It leaves two arms of the private branching
# untaken; each test here FAILS if its target arm is inverted or removed.
RSpec.describe VersionRetrievalService, type: :service do
  let(:short_read_mngs_workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }

  describe "pinned prefix that the app-config default already satisfies" do
    before do
      # default_version (from app_config) is "2.0.0".
      AppConfigHelper.set_workflow_version(short_read_mngs_workflow, "2.0.0")
      @project = create(:project)
      # Pin the project to prefix "2.0" -- which "2.0.0" starts with.
      create(:project_workflow_version, project_id: @project.id,
                                        workflow: short_read_mngs_workflow, version_prefix: "2.0")
    end

    it "returns the app-config default (the `default_version.start_with?(prefix)` true arm)" do
      # In fetch_and_validate_version_to_run the elsif right-hand side is TRUE, so it
      # returns default_version and NEVER calls prepare_specific_workflow_version...
      # There is deliberately NO WorkflowVersion row matching "2.0%", so if this arm
      # were removed the else path would raise workflow_version_not_found instead of
      # returning "2.0.0".
      expect(VersionRetrievalService.call(@project.id, short_read_mngs_workflow)).to eq("2.0.0")
    end
  end

  describe "default_version for the human-host-genome workflow" do
    before do
      @project = create(:project)
      create(:workflow_version, workflow: HostGenome::HUMAN_HOST, version: "1")
      create(:workflow_version, workflow: HostGenome::HUMAN_HOST, version: "2")
    end

    it "returns the latest host-genome version (the `HostGenome::HUMAN_HOST` elsif arm)" do
      # No pin + no user prefix -> default_version -> the HUMAN_HOST branch ->
      # WorkflowVersion.latest_version_of(HUMAN_HOST) == "2". If that arm were removed
      # the fall-through else reads an unset app_config and would not return "2".
      expect(VersionRetrievalService.call(@project.id, HostGenome::HUMAN_HOST)).to eq("2")
    end
  end
end

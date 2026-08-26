require "rails_helper"

# CZID-972 -- prefix resolution must pick the highest version IN THE PREFIX'S LINE.
#
# Both halves of fetch_latest_version_for_version_prefix were string operations: `LIKE '8.1%'` also
# matched 8.10.x, and `ORDER BY version DESC` picked 8.1.9 over 8.1.11.
RSpec.describe VersionRetrievalService, type: :service do
  let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }
  let(:project) { create(:project) }

  # Force the prefix path: pin the project to a line that the app_config default does NOT share, so
  # the service resolves through the pin rather than returning the configured default.
  def pin_project_to(prefix)
    create(:project_workflow_version, project_id: project.id, workflow: workflow, version_prefix: prefix)
  end

  def configure_default(version)
    AppConfigHelper.set_app_config(format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: workflow), version)
    create(:workflow_version, workflow: workflow, version: version)
  end

  before { configure_default("9.0.0") }

  it "resolves a prefix to the numerically highest version, not the lexically highest" do
    create(:workflow_version, workflow: workflow, version: "8.1.9")
    create(:workflow_version, workflow: workflow, version: "8.1.11")
    pin_project_to("8.1")

    expect(VersionRetrievalService.call(project.id, workflow)).to eq("8.1.11")
  end

  it "does not leak a different minor line that merely shares a string prefix" do
    # LIKE '8.1%' matches 8.10.5, which is NOT in the 8.1 line.
    create(:workflow_version, workflow: workflow, version: "8.1.2")
    create(:workflow_version, workflow: workflow, version: "8.10.5")
    pin_project_to("8.1")

    expect(VersionRetrievalService.call(project.id, workflow)).to eq("8.1.2")
  end

  it "resolves a major-line prefix across minors numerically" do
    create(:workflow_version, workflow: workflow, version: "8.9.0")
    create(:workflow_version, workflow: workflow, version: "8.10.0")
    pin_project_to("8")

    expect(VersionRetrievalService.call(project.id, workflow)).to eq("8.10.0")
  end

  it "raises when nothing matches the prefix after segment filtering" do
    create(:workflow_version, workflow: workflow, version: "8.10.5")
    pin_project_to("8.1")

    expect { VersionRetrievalService.call(project.id, workflow) }.to raise_error(/does not exist/)
  end

  it "still refuses a non-runnable version resolved through a prefix" do
    create(:workflow_version, workflow: workflow, version: "8.1.11", runnable: false)
    pin_project_to("8.1")

    expect { VersionRetrievalService.call(project.id, workflow) }.to raise_error(/not runnable/)
  end
end

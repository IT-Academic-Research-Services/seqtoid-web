require "rails_helper"

# CZID-976 -- a user-selected version wins over the project pin.
#
# The old behaviour raised project_workflow_version_already_pinned whenever the project was pinned
# AND the user specified a version. The dev census on 2026-08-04 found ALL 33 projects pinned at a
# major prefix, so that raise made per-run selection impossible in practice rather than merely
# awkward.
RSpec.describe VersionRetrievalService, type: :service do
  let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }
  let(:project) { create(:project) }

  def configure_default(version)
    AppConfigHelper.set_app_config(format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: workflow), version)
    create(:workflow_version, workflow: workflow, version: version)
  end

  before { configure_default("8.3.15") }

  describe "user selection over a pinned project" do
    before { create(:project_workflow_version, project_id: project.id, workflow: workflow, version_prefix: "8") }

    it "honours the selection instead of raising" do
      create(:workflow_version, workflow: workflow, version: "8.1.2")

      expect(VersionRetrievalService.call(project.id, workflow, "8.1.2")).to eq("8.1.2")
    end

    it "resolves a partial selection to the highest match in that line" do
      create(:workflow_version, workflow: workflow, version: "8.1.2")
      create(:workflow_version, workflow: workflow, version: "8.1.11")

      expect(VersionRetrievalService.call(project.id, workflow, "8.1")).to eq("8.1.11")
    end

    it "lets the selection cross the pinned line entirely" do
      # The pin says "8"; the user asks for 7. Per-run selection means the user wins.
      create(:workflow_version, workflow: workflow, version: "7.4.0")

      expect(VersionRetrievalService.call(project.id, workflow, "7")).to eq("7.4.0")
    end

    it "falls back to the pin/default when no selection is made" do
      expect(VersionRetrievalService.call(project.id, workflow)).to eq("8.3.15")
    end
  end

  describe "user selection on an unpinned project" do
    it "is honoured" do
      create(:workflow_version, workflow: workflow, version: "8.1.2")

      expect(VersionRetrievalService.call(project.id, workflow, "8.1.2")).to eq("8.1.2")
    end
  end

  describe "validation of the selection" do
    # The value reaches a LIKE '<prefix>%' query, so its shape is checked before it gets there.
    ["8.1.2.3", "eight", "8; DROP TABLE", "%", "8%", "-1", "", "  "].each do |bad|
      it "rejects #{bad.inspect}" do
        expect { VersionRetrievalService.call(project.id, workflow, bad) }
          .to raise_error(/Invalid version|does not exist/)
      end
    end

    it "rejects a wildcard rather than letting it match everything" do
      create(:workflow_version, workflow: workflow, version: "8.1.2")

      expect { VersionRetrievalService.call(project.id, workflow, "%") }
        .to raise_error(/Invalid version/)
    end

    ["8", "8.1", "8.1.2"].each do |good|
      it "accepts #{good.inspect}" do
        create(:workflow_version, workflow: workflow, version: "8.1.2")

        expect { VersionRetrievalService.call(project.id, workflow, good) }.not_to raise_error
      end
    end
  end

  describe "the catalog gate still applies to a selection" do
    it "refuses a selected version that is not runnable" do
      create(:workflow_version, workflow: workflow, version: "8.1.2", runnable: false)

      expect { VersionRetrievalService.call(project.id, workflow, "8.1.2") }
        .to raise_error(/not runnable/)
    end

    it "refuses a selected version that is deprecated" do
      create(:workflow_version, workflow: workflow, version: "8.1.2", deprecated: true)

      expect { VersionRetrievalService.call(project.id, workflow, "8.1.2") }
        .to raise_error(/deprecated/)
    end

    it "refuses a selection with no catalog match" do
      expect { VersionRetrievalService.call(project.id, workflow, "6.6.6") }
        .to raise_error(/does not exist/)
    end
  end
end

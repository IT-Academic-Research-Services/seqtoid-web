require "rails_helper"

# CZID-976 -- a user-selected version wins over the project pin.
#
# The old behaviour raised project_workflow_version_already_pinned whenever the project was pinned
# AND the user specified a version. The dev census on 2026-08-04 found ALL 33 projects pinned at a
# major prefix, so that raise made per-run selection impossible in practice rather than merely
# awkward.
#
# LITERAL SELECTION -- an explicit choice runs EXACTLY as chosen. It is NOT expanded to the latest
# version sharing its prefix, because that silently ran a different version than the dropdown showed.
# Prefix expansion still applies to the pin/default path (no selection = latest of the pinned line).
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

    it "runs the chosen version LITERALLY, not the latest patch in that line" do
      # The line has a higher patch available, but the user asked for a specific one. Running 8.1.11
      # here would silently give them a version they did not choose. Selecting 8.1.2 runs 8.1.2.
      create(:workflow_version, workflow: workflow, version: "8.1.2")
      create(:workflow_version, workflow: workflow, version: "8.1.11")

      expect(VersionRetrievalService.call(project.id, workflow, "8.1.2")).to eq("8.1.2")
    end

    it "does NOT expand an older selection up to the configured default" do
      # 8.3.15 is the default/latest; the user explicitly picked 8.0.0. They get 8.0.0.
      create(:workflow_version, workflow: workflow, version: "8.0.0")

      expect(VersionRetrievalService.call(project.id, workflow, "8.0.0")).to eq("8.0.0")
    end

    it "lets the selection cross the pinned line entirely" do
      # The pin says "8"; the user asks for a specific 7.x. Per-run selection means the user wins.
      create(:workflow_version, workflow: workflow, version: "7.4.0")

      expect(VersionRetrievalService.call(project.id, workflow, "7.4.0")).to eq("7.4.0")
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

  describe "a bare prefix is no longer silently expanded" do
    # The per-run selector only ever submits full catalogued version strings. A bare prefix names no
    # workflow_versions row, so it is an honest not-found rather than a silent upgrade to latest.
    it "refuses a major-only selection instead of running the latest of that line" do
      create(:workflow_version, workflow: workflow, version: "8.1.2")

      expect { VersionRetrievalService.call(project.id, workflow, "8") }
        .to raise_error(/does not exist/)
    end

    it "refuses a major.minor selection instead of running the latest patch" do
      create(:workflow_version, workflow: workflow, version: "8.1.2")
      create(:workflow_version, workflow: workflow, version: "8.1.11")

      expect { VersionRetrievalService.call(project.id, workflow, "8.1") }
        .to raise_error(/does not exist/)
    end
  end

  describe "validation of the selection" do
    # The value reaches a catalog lookup, so its shape is checked before it gets there. Malformed
    # values are rejected as bad input; well-formed values that name no row are a clear not-found.
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

    it "resolves an exact catalogued version" do
      create(:workflow_version, workflow: workflow, version: "8.1.2")

      expect(VersionRetrievalService.call(project.id, workflow, "8.1.2")).to eq("8.1.2")
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

require "rails_helper"

# CZID-982 -- the default dispatch path must consult the catalog.
#
# Before this change, the middle branch of `fetch_and_validate_version_to_run` returned the
# app_config value verbatim: no catalog lookup, no `runnable` / `deprecated` check. Because every
# project is pinned at a MAJOR prefix ("8") and the app_config default shares that major ("8.3.15"),
# that branch is the one virtually every real run takes -- so the flags gated nothing. Staging had
# 137 runs at versions with no `workflow_versions` row at all.
RSpec.describe VersionRetrievalService, type: :service do
  let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }
  let(:project) { create(:project) }

  # Set the app_config default WITHOUT going through AppConfigHelper.set_workflow_version, which
  # would create the catalog row as a side effect and hide the very drift under test.
  def configure_default_without_cataloguing(version)
    AppConfigHelper.set_app_config(format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: workflow), version)
  end

  describe "the default path (no user-specified prefix, no project pin)" do
    it "returns the configured default when it is catalogued and runnable" do
      configure_default_without_cataloguing("8.3.15")
      create(:workflow_version, workflow: workflow, version: "8.3.15")

      expect(VersionRetrievalService.call(project.id, workflow)).to eq("8.3.15")
    end

    it "refuses a default that is not in the catalog at all" do
      # Exactly the staging condition: app_config names 8.3.15, the catalog only knows 8.3.11.
      configure_default_without_cataloguing("8.3.15")
      create(:workflow_version, workflow: workflow, version: "8.3.11")

      expect { VersionRetrievalService.call(project.id, workflow) }
        .to raise_error(/is not in the catalog/)
    end

    it "refuses a default that is catalogued but not runnable" do
      configure_default_without_cataloguing("8.3.15")
      create(:workflow_version, workflow: workflow, version: "8.3.15", runnable: false)

      expect { VersionRetrievalService.call(project.id, workflow) }
        .to raise_error(/not runnable/)
    end

    it "refuses a default that is catalogued but deprecated" do
      configure_default_without_cataloguing("8.3.15")
      create(:workflow_version, workflow: workflow, version: "8.3.15", deprecated: true)

      expect { VersionRetrievalService.call(project.id, workflow) }
        .to raise_error(/deprecated/)
    end
  end

  describe "the default path when the project is pinned at a major prefix" do
    # The real-world shape: every project pinned to "8", app_config on "8.3.15". The pin
    # prefix-matches the default, so this still takes the default branch -- which is precisely why
    # the missing catalog check mattered.
    before { create(:project_workflow_version, project_id: project.id, workflow: workflow, version_prefix: "8") }

    it "validates against the catalog rather than trusting app_config" do
      configure_default_without_cataloguing("8.3.15")

      expect { VersionRetrievalService.call(project.id, workflow) }
        .to raise_error(/is not in the catalog/)
    end

    it "returns the default once it is catalogued" do
      configure_default_without_cataloguing("8.3.15")
      create(:workflow_version, workflow: workflow, version: "8.3.15")

      expect(VersionRetrievalService.call(project.id, workflow)).to eq("8.3.15")
    end
  end

  describe "paths that must not regress" do
    it "still resolves the human host genome default, which is catalog-sourced by construction" do
      create(:workflow_version, workflow: HostGenome::HUMAN_HOST, version: "1")
      create(:workflow_version, workflow: HostGenome::HUMAN_HOST, version: "2")

      expect(VersionRetrievalService.call(project.id, HostGenome::HUMAN_HOST)).to eq("2")
    end

    it "still resolves the NCBI index default when it is catalogued" do
      create(:app_config, key: AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME, value: "2024-02-06")
      create(:workflow_version, workflow: AlignmentConfig::NCBI_INDEX, version: "2024-02-06")

      expect(VersionRetrievalService.call(project.id, AlignmentConfig::NCBI_INDEX)).to eq("2024-02-06")
    end

    it "refuses an NCBI index default that is not catalogued" do
      # The reconciliation seed migration covers this key explicitly so it cannot happen in a
      # deployed environment, but the guard must still hold.
      create(:app_config, key: AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME, value: "2099-01-01")

      expect { VersionRetrievalService.call(project.id, AlignmentConfig::NCBI_INDEX) }
        .to raise_error(/is not in the catalog/)
    end
  end
end

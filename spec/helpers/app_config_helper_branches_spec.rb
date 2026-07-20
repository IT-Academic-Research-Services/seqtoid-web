require "rails_helper"

# Branch sweep for AppConfigHelper. The existing spec covers get/set/remove and
# update_default_alignment_config; this file targets the uncovered branches of
# get_json_app_config (valid JSON / blank / whitespace-only / parse-error with
# raise_error true vs false), configs_for_context's flag coercions, and the
# find-or-create arm of create_workflow_version. get_json_app_config cases stub
# get_app_config so they touch no DB. Each example flips a single branch. Spec-only.
RSpec.describe AppConfigHelper, type: :helper do
  describe "#get_json_app_config" do
    it "parses and returns the JSON when the stored value is present and valid" do
      allow(AppConfigHelper).to receive(:get_app_config).with("k").and_return('{"a":1}')
      expect(AppConfigHelper.get_json_app_config("k")).to eq("a" => 1)
    end

    it "returns the default when the stored value is absent (present? is false)" do
      allow(AppConfigHelper).to receive(:get_app_config).with("k").and_return(nil)
      expect(AppConfigHelper.get_json_app_config("k", "fallback")).to eq("fallback")
    end

    it "returns the default when the stored value is only whitespace (strip guard)" do
      allow(AppConfigHelper).to receive(:get_app_config).with("k").and_return("   ")
      expect(AppConfigHelper.get_json_app_config("k", "fallback")).to eq("fallback")
    end

    it "logs and returns the default on a parse error when raise_error is false" do
      allow(AppConfigHelper).to receive(:get_app_config).with("k").and_return("{not json")
      expect(Rails.logger).to receive(:error).with(/error parsing JSON config key/)
      expect(AppConfigHelper.get_json_app_config("k", "fallback")).to eq("fallback")
    end

    it "re-raises the parse error when raise_error is true" do
      allow(AppConfigHelper).to receive(:get_app_config).with("k").and_return("{not json")
      allow(Rails.logger).to receive(:error)
      expect { AppConfigHelper.get_json_app_config("k", "fallback", true) }
        .to raise_error(JSON::ParserError)
    end
  end

  describe "#configs_for_context flag coercions" do
    it "reports autoAccountCreationEnabled true and integer-coerces the max fields when set to '1'" do
      AppConfigHelper.set_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1, "1")
      AppConfigHelper.set_app_config(AppConfig::MAX_OBJECTS_BULK_DOWNLOAD, "25")
      AppConfigHelper.set_app_config(AppConfig::MAX_SAMPLES_BULK_DOWNLOAD_ORIGINAL_FILES, "7")

      ctx = AppConfigHelper.configs_for_context
      expect(ctx[:autoAccountCreationEnabled]).to be(true)
      expect(ctx[:maxObjectsBulkDownload]).to eq(25)
      expect(ctx[:maxSamplesBulkDownloadOriginalFiles]).to eq(7)
    end

    it "reports autoAccountCreationEnabled false for any non-'1' value" do
      AppConfigHelper.set_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1, "0")
      expect(AppConfigHelper.configs_for_context[:autoAccountCreationEnabled]).to be(false)
    end
  end

  describe "#create_workflow_version find-or-create arm" do
    it "creates a WorkflowVersion when none exists for the workflow+version" do
      expect do
        AppConfigHelper.create_workflow_version("branchcov-workflow", "9.9.9")
      end.to change { WorkflowVersion.where(workflow: "branchcov-workflow", version: "9.9.9").count }.from(0).to(1)
    end

    it "does not create a duplicate when the WorkflowVersion already exists" do
      WorkflowVersion.create(workflow: "branchcov-workflow", version: "8.8.8", deprecated: false, runnable: true)
      expect do
        AppConfigHelper.create_workflow_version("branchcov-workflow", "8.8.8")
      end.not_to change { WorkflowVersion.where(workflow: "branchcov-workflow", version: "8.8.8").count }
    end
  end
end

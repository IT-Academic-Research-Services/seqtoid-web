require "rails_helper"
require "webmock/rspec"

RSpec.describe AppConfigHelper, type: :helper do
  describe "get_app_config" do
    context "when key exists" do
      it "returns the value" do
        config_key = "test_key_to_get"
        AppConfigHelper.set_app_config(config_key, "1")
        expect(AppConfigHelper.get_app_config(config_key)).to eq("1")
      end
    end

    context "when key does not exist" do
      it "returns default_value is passed in" do
        expect(AppConfigHelper.get_app_config("nonexistant_key_for_get", "0")).to eq("0")
      end

      it "returns nil when no default_value is passed in" do
        expect(AppConfigHelper.get_app_config("nonexistant_key_for_get")).to be_nil
      end
    end
  end

  describe "#set_app_config" do
    context "when key does not exist" do
      it "adds new key with given value" do
        new_key = "new_config_key"
        expect { AppConfigHelper.set_app_config(new_key, "1") }.to change(AppConfig, :count).by(1)
        expect(AppConfig.find_by(key: new_key).value).to eq("1")
      end
    end

    context "when key does already exists" do
      it "adds new key with given value" do
        existing_key = "existing_config_key"
        AppConfigHelper.set_app_config(existing_key, "0")
        expect { AppConfigHelper.set_app_config(existing_key, "1") }.to change(AppConfig, :count).by(0)
        expect(AppConfig.find_by(key: existing_key).value).to eq("1")
      end
    end
  end

  describe "#remove_app_config" do
    it "removes AppConfig with the given key" do
      test_config_key = "test_key_to_delete"
      test_config_value = "0"
      AppConfigHelper.set_app_config(test_config_key, test_config_value)

      expect(Rails.logger).to receive(:info).with("[AppConfigHelper#remove_app_config] removing key '#{test_config_key}' with value '#{test_config_value}'")
      expect(Rails.cache).to receive(:delete).with("app_config-#{test_config_key}")
      expect { AppConfigHelper.remove_app_config(test_config_key) }.to change(AppConfig, :count).by(-1)
      expect(AppConfig.find_by(key: test_config_key)).to be_nil
    end

    it "logs an error when key does not exist" do
      invalid_key = "does_not_exist"
      expect(Rails.logger).to receive(:error).with("[AppConfigHelper#remove_app_config] could not find key '#{invalid_key}'")
      AppConfigHelper.remove_app_config(invalid_key)
    end
  end

  describe "#update_alignment_config" do
    let(:alignment_config_name) { "fake alignment config name" }

    subject { AppConfigHelper.update_default_alignment_config(alignment_config_name) }

    context "when alignment config does not exist for the supplied name" do
      it "raises an error" do
        expect { subject }.to raise_error(RuntimeError, "Alignment config does not exist")
      end
    end

    context "when the alignment config name corresponds to a valid alignment config" do
      before do
        create(:alignment_config, name: alignment_config_name)
      end

      it "creates a workflow version for the NCBI index" do
        subject
        expect(WorkflowVersion.find_by(workflow: AlignmentConfig::NCBI_INDEX, version: alignment_config_name)).to_not be_nil
      end

      it "updates the app config" do
        subject
        expect(AppConfig.find_by(key: AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME).value).to eq(alignment_config_name)
      end
    end
  end

  # SMP-1724 -- non-downgrading seed setter for `<workflow>-version` app_configs.
  describe "#seed_workflow_version" do
    let(:key) { "short-read-mngs-version" }

    context "when the default is absent (fresh bootstrap)" do
      it "sets the seed value and catalogues it" do
        expect(AppConfig.find_by(key: key)).to be_nil
        result = AppConfigHelper.seed_workflow_version("short-read-mngs", "8.3.15")
        expect(result).to eq("8.3.15")
        expect(AppConfig.find_by(key: key).value).to eq("8.3.15")
        expect(WorkflowVersion.exists?(workflow: "short-read-mngs", version: "8.3.15")).to be(true)
      end
    end

    context "when the live default is NEWER than the seed value" do
      before do
        AppConfigHelper.set_app_config(key, "8.3.16")
        create(:workflow_version, workflow: "short-read-mngs", version: "8.3.16")
      end

      it "preserves the live value and never downgrades" do
        result = AppConfigHelper.seed_workflow_version("short-read-mngs", "8.3.15")
        expect(result).to eq("8.3.16")
        expect(AppConfig.find_by(key: key).value).to eq("8.3.16")
      end

      it "does not create a catalog row for the stale seed value" do
        AppConfigHelper.seed_workflow_version("short-read-mngs", "8.3.15")
        expect(WorkflowVersion.exists?(workflow: "short-read-mngs", version: "8.3.15")).to be(false)
      end

      it "guarantees the preserved live value is catalogued even if it was not already" do
        WorkflowVersion.where(workflow: "short-read-mngs", version: "8.3.16").delete_all
        AppConfigHelper.seed_workflow_version("short-read-mngs", "8.3.15")
        expect(WorkflowVersion.exists?(workflow: "short-read-mngs", version: "8.3.16")).to be(true)
      end
    end

    context "when the live default is OLDER than the seed value" do
      before { AppConfigHelper.set_app_config(key, "8.3.11") }

      it "advances the default to the seed value and catalogues it" do
        result = AppConfigHelper.seed_workflow_version("short-read-mngs", "8.3.15")
        expect(result).to eq("8.3.15")
        expect(AppConfig.find_by(key: key).value).to eq("8.3.15")
        expect(WorkflowVersion.exists?(workflow: "short-read-mngs", version: "8.3.15")).to be(true)
      end
    end

    context "when the live default equals the seed value" do
      before { AppConfigHelper.set_app_config(key, "8.3.15") }

      it "leaves the value in place (no downgrade, no error)" do
        expect { AppConfigHelper.seed_workflow_version("short-read-mngs", "8.3.15") }
          .not_to(change { AppConfig.find_by(key: key).value })
        expect(AppConfig.find_by(key: key).value).to eq("8.3.15")
      end
    end

    context "when the live value is not semver-parseable" do
      before { AppConfigHelper.set_app_config(key, "custom-tag") }

      it "preserves it rather than clobbering with a semver seed" do
        result = AppConfigHelper.seed_workflow_version("short-read-mngs", "8.3.15")
        expect(result).to eq("custom-tag")
        expect(AppConfig.find_by(key: key).value).to eq("custom-tag")
      end
    end
  end

  describe "#version_older?" do
    it "orders by semantic version, not string comparison" do
      expect(AppConfigHelper.version_older?("8.3.9", "8.3.10")).to be(true) # string compare would say false
      expect(AppConfigHelper.version_older?("8.3.16", "8.3.15")).to be(false)
      expect(AppConfigHelper.version_older?("8.3.15", "8.3.15")).to be(false)
    end

    it "treats unparseable versions as NOT older, so a live value is preserved" do
      expect(AppConfigHelper.version_older?("custom-tag", "8.3.15")).to be(false)
    end
  end
end

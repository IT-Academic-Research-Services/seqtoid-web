require "rails_helper"
# lib/seed_resources is NOT on the Rails autoload path, so SeedResource::AppConfigs
# is undefined unless explicitly loaded. app_configs.rb self-loads its deps
# (require_relative 'seed_resource' + require 'factory_bot'), so a single ABSOLUTE
# require is sufficient and deterministic in the full CI suite. (A relative
# `require_all "lib/seed_resources"` silently loaded nothing under the full run ->
# `uninitialized constant SeedResource`, which aborted the entire suite.)
require Rails.root.join("lib/seed_resources/app_configs").to_s

# Regression coverage for #385: the SFN state-machine ARNs seeded here used to
# hardcode the "dev" deployment stage, so seeding in the staging account produced
# `idseq-swipe-dev-...` in the staging account -> Aws::States::StateMachineDoesNotExist.
# The stage is now derived from ENV["ENVIRONMENT"] (defaulting to "dev"), so each
# account/env seeds its own state machine name.
RSpec.describe SeedResource::AppConfigs do
  describe "#sfn_configs" do
    let(:account_id) { "030998640247" }

    subject(:sfn_configs) { described_class.new.send(:sfn_configs) }

    around do |example|
      original_account = ENV["AWS_ACCOUNT_ID"]
      original_environment = ENV["ENVIRONMENT"]
      original_swipe_app_name = ENV["SWIPE_APP_NAME"]
      ENV["AWS_ACCOUNT_ID"] = account_id
      example.run
      ENV["AWS_ACCOUNT_ID"] = original_account
      ENV["ENVIRONMENT"] = original_environment
      ENV["SWIPE_APP_NAME"] = original_swipe_app_name
    end

    context "when ENVIRONMENT is set (e.g. staging)" do
      before { ENV["ENVIRONMENT"] = "staging" }

      it "seeds ARNs that point at the environment's own state machine" do
        sfn_configs

        expect(AppConfigHelper.get_app_config(AppConfig::SFN_SINGLE_WDL_ARN))
          .to eq("arn:aws:states:us-west-2:#{account_id}:stateMachine:idseq-swipe-staging-default-wdl")
        expect(AppConfigHelper.get_app_config(AppConfig::SFN_ARN))
          .to eq("arn:aws:states:us-west-2:#{account_id}:stateMachine:idseq-swipe-staging-short-read-mngs-wdl")
        expect(AppConfigHelper.get_app_config(AppConfig::SFN_MNGS_ARN))
          .to eq("arn:aws:states:us-west-2:#{account_id}:stateMachine:idseq-swipe-staging-short-read-mngs-wdl")
        expect(AppConfigHelper.get_app_config(AppConfig::SFN_CG_ARN))
          .to eq("arn:aws:states:us-west-2:#{account_id}:stateMachine:idseq-swipe-staging-default-wdl")
      end

      it "does not seed a dev-named state machine in a non-dev account" do
        sfn_configs

        [AppConfig::SFN_SINGLE_WDL_ARN, AppConfig::SFN_ARN, AppConfig::SFN_MNGS_ARN, AppConfig::SFN_CG_ARN].each do |key|
          expect(AppConfigHelper.get_app_config(key)).not_to include("idseq-swipe-dev-")
        end
      end
    end

    context "when ENVIRONMENT is unset (local/dev parity)" do
      before { ENV["ENVIRONMENT"] = nil }

      it "defaults the stage to dev so existing dev behaviour is unchanged" do
        sfn_configs

        expect(AppConfigHelper.get_app_config(AppConfig::SFN_SINGLE_WDL_ARN))
          .to eq("arn:aws:states:us-west-2:#{account_id}:stateMachine:idseq-swipe-dev-default-wdl")
      end
    end

    context "when ENVIRONMENT is blank" do
      before { ENV["ENVIRONMENT"] = "" }

      it "treats a blank value the same as unset and defaults to dev" do
        sfn_configs

        expect(AppConfigHelper.get_app_config(AppConfig::SFN_ARN))
          .to eq("arn:aws:states:us-west-2:#{account_id}:stateMachine:idseq-swipe-dev-short-read-mngs-wdl")
      end
    end

    # A fresh seqtoid env (e.g. env-staging) whose swipe is named seqtoid-swipe-<env> to avoid
    # colliding with the live legacy idseq-swipe-<env> in the same account sets SWIPE_APP_NAME via
    # Chamber. The seeded ARNs must follow it, not the idseq-swipe default (else the app would dispatch
    # onto the legacy state machine -- a cross-env leak).
    context "when SWIPE_APP_NAME is set (isolated seqtoid env)" do
      before do
        ENV["ENVIRONMENT"] = "staging"
        ENV["SWIPE_APP_NAME"] = "seqtoid-swipe-staging"
      end

      it "seeds ARNs that follow SWIPE_APP_NAME, not the idseq-swipe default" do
        sfn_configs

        expect(AppConfigHelper.get_app_config(AppConfig::SFN_SINGLE_WDL_ARN))
          .to eq("arn:aws:states:us-west-2:#{account_id}:stateMachine:seqtoid-swipe-staging-default-wdl")
        expect(AppConfigHelper.get_app_config(AppConfig::SFN_ARN))
          .to eq("arn:aws:states:us-west-2:#{account_id}:stateMachine:seqtoid-swipe-staging-short-read-mngs-wdl")
        expect(AppConfigHelper.get_app_config(AppConfig::SFN_MNGS_ARN))
          .to eq("arn:aws:states:us-west-2:#{account_id}:stateMachine:seqtoid-swipe-staging-short-read-mngs-wdl")
        expect(AppConfigHelper.get_app_config(AppConfig::SFN_CG_ARN))
          .to eq("arn:aws:states:us-west-2:#{account_id}:stateMachine:seqtoid-swipe-staging-default-wdl")
      end

      it "does not seed any idseq-swipe-named state machine" do
        sfn_configs

        [AppConfig::SFN_SINGLE_WDL_ARN, AppConfig::SFN_ARN, AppConfig::SFN_MNGS_ARN, AppConfig::SFN_CG_ARN].each do |key|
          expect(AppConfigHelper.get_app_config(key)).not_to include("idseq-swipe-")
        end
      end
    end
  end
end

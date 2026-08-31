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

  # SMP-1709: self-service signup is seeded EXPLICITLY per deployment stage -- enabled ("1") only in
  # the dev stage, disabled ("0") in every gated env (beta/staging/prod). Stage comes from
  # ENV["ENVIRONMENT"] (default "dev"). find_or_create must never overwrite an out-of-band value.
  describe "#self_service_signup_flag" do
    subject(:self_service_signup_flag) { described_class.new.send(:self_service_signup_flag) }

    around do |example|
      original_environment = ENV["ENVIRONMENT"]
      example.run
      ENV["ENVIRONMENT"] = original_environment
    end

    context "in the dev stage" do
      before { ENV["ENVIRONMENT"] = "dev" }

      it "enables self-service signup" do
        self_service_signup_flag
        expect(AppConfigHelper.get_app_config(AppConfig::SELF_SERVICE_SIGNUP_ENABLED)).to eq("1")
      end
    end

    context "when ENVIRONMENT is unset (local/dev parity)" do
      before { ENV["ENVIRONMENT"] = nil }

      it "defaults to the dev stage and enables signup" do
        self_service_signup_flag
        expect(AppConfigHelper.get_app_config(AppConfig::SELF_SERVICE_SIGNUP_ENABLED)).to eq("1")
      end
    end

    %w[staging prod beta].each do |gated_stage|
      context "in the gated #{gated_stage} stage" do
        before { ENV["ENVIRONMENT"] = gated_stage }

        it "disables self-service signup (fail-closed)" do
          self_service_signup_flag
          expect(AppConfigHelper.get_app_config(AppConfig::SELF_SERVICE_SIGNUP_ENABLED)).to eq("0")
        end
      end
    end

    it "NEVER overwrites a value an operator set out-of-band" do
      ENV["ENVIRONMENT"] = "staging"
      AppConfig.create!(key: AppConfig::SELF_SERVICE_SIGNUP_ENABLED, value: "1")

      self_service_signup_flag

      expect(AppConfigHelper.get_app_config(AppConfig::SELF_SERVICE_SIGNUP_ENABLED)).to eq("1")
    end

    it "is idempotent -- a re-seed creates no duplicate rows" do
      ENV["ENVIRONMENT"] = "dev"
      self_service_signup_flag
      count_after_first = AppConfig.count

      expect { self_service_signup_flag }.not_to change(AppConfig, :count)
      expect(AppConfig.count).to eq(count_after_first)
    end
  end

  # SMP-1686: the Descartes / export-control Layer 3 gate + tuning rows must be seeded EXPLICITLY (their
  # state was previously implicit -- no row existed), but seeding must NEVER flip a gate on and a re-seed
  # must NEVER overwrite a value someone deliberately set out-of-band.
  describe "#export_control_flags" do
    subject(:export_control_flags) { described_class.new.send(:export_control_flags) }

    # Every gate flag must seed OFF ("0"). ENABLE_EXPORT_CONTROL_LAYER3 is the master gate.
    let(:gate_flags) do
      [
        AppConfig::ENABLE_EXPORT_CONTROL_LAYER3,
        AppConfig::ENABLE_EXPORT_CONTROL_SCREEN_ONBOARDING,
        AppConfig::ENABLE_EXPORT_CONTROL_SCREEN_RELEASE,
        AppConfig::ENABLE_DESCARTES_SCREENING,
        AppConfig::ENABLE_EXPORT_CONTROL_ATTESTATION,
        AppConfig::ENABLE_EXPORT_CONTROL_DEVICE_ATTESTATION,
      ]
    end

    it "seeds every gate flag OFF (\"0\") -- it never flips anything on" do
      export_control_flags

      gate_flags.each do |key|
        expect(AppConfigHelper.get_app_config(key)).to eq("0")
      end
    end

    it "seeds the tuning rows to their conservative / fail-closed defaults" do
      export_control_flags

      expect(AppConfigHelper.get_app_config(AppConfig::EXPORT_CONTROL_RPS_GROUPS)).to eq("")
      expect(AppConfigHelper.get_app_config(AppConfig::EXPORT_CONTROL_SCREENING_WHITELIST)).to eq("")
      expect(AppConfigHelper.get_app_config(AppConfig::EXPORT_CONTROL_RESCREEN_CADENCE_DAYS)).to eq("0")
      expect(AppConfigHelper.get_app_config(AppConfig::EXPORT_CONTROL_HIT_HANDLING)).to eq("hold")
    end

    it "does NOT seed the Descartes resolution poll cursor (the poller manages it)" do
      export_control_flags

      expect(AppConfig.where(key: AppConfig::DESCARTES_RESOLUTION_POLL_CURSOR)).not_to exist
    end

    it "is idempotent -- a re-seed creates no duplicate rows" do
      export_control_flags
      count_after_first = AppConfig.count

      expect { export_control_flags }.not_to change(AppConfig, :count)
      expect(AppConfig.count).to eq(count_after_first)
    end

    it "NEVER overwrites a gate someone deliberately turned on" do
      # Simulate an operator enabling the master gate out-of-band before a redeploy re-runs the seed.
      AppConfig.create!(key: AppConfig::ENABLE_EXPORT_CONTROL_LAYER3, value: "1")

      export_control_flags

      expect(AppConfigHelper.get_app_config(AppConfig::ENABLE_EXPORT_CONTROL_LAYER3)).to eq("1")
    end

    it "NEVER overwrites a tuning row that was already customized" do
      AppConfig.create!(key: AppConfig::EXPORT_CONTROL_HIT_HANDLING, value: "block")
      AppConfig.create!(key: AppConfig::EXPORT_CONTROL_SCREENING_WHITELIST, value: '["ucsf.edu"]')

      export_control_flags

      expect(AppConfigHelper.get_app_config(AppConfig::EXPORT_CONTROL_HIT_HANDLING)).to eq("block")
      expect(AppConfigHelper.get_app_config(AppConfig::EXPORT_CONTROL_SCREENING_WHITELIST)).to eq('["ucsf.edu"]')
    end
  end
end

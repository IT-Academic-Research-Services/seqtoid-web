require 'factory_bot'
require_relative 'seed_resource'

module SeedResource
  class AppConfigs < Base
    CURRENT_ALIGNMENT_CONFIG_NAME = "2024-02-06".freeze

    def seed
      launched_features
      workflow_versions
      sfn_configs
      alignment_config
    end

    private

    def sfn_configs
      account_id = ENV["AWS_ACCOUNT_ID"]
      # Fail loud rather than seed a broken ARN. When AWS_ACCOUNT_ID is blank the
      # interpolation below produces `arn:aws:states:us-west-2::stateMachine:...`
      # (empty account segment), which the app persists to app_config and only
      # discovers at dispatch time as Aws::States::Errors::InvalidArn ("AccountId
      # can not be empty") -- after the sample upload, with nothing recorded. This
      # bit per-PR preview sandboxes whose chart did not export AWS_ACCOUNT_ID
      # (platform-overhaul 728). find_or_create never overwrites, so a silent
      # mis-seed persists until the sandbox is re-provisioned; aborting here makes
      # a mis-seed impossible instead of merely unlikely.
      raise "SeedResource::AppConfigs: AWS_ACCOUNT_ID is blank -- refusing to seed empty-account SFN ARNs" if account_id.blank?

      # The SWIPE state machines are named per deployment stage (idseq-swipe-<stage>-...).
      # Previously the stage was hardcoded to "dev", so seeding in the staging account produced
      # `idseq-swipe-dev-default-wdl` in the staging account -> StateMachineDoesNotExist (#385).
      # Derive the stage from ENV["ENVIRONMENT"] (the same var db/seeds.rb already uses), defaulting
      # to "dev" so local/dev seeding behaviour is unchanged.
      stage = ENV["ENVIRONMENT"].presence || "dev"
      find_or_create(:app_config, key: AppConfig::SFN_SINGLE_WDL_ARN, value: "arn:aws:states:us-west-2:#{account_id}:stateMachine:idseq-swipe-#{stage}-default-wdl")
      find_or_create(:app_config, key: AppConfig::ENABLE_SFN_NOTIFICATIONS, value: "1")

      find_or_create(:app_config, key: AppConfig::SFN_ARN, value: "arn:aws:states:us-west-2:#{account_id}:stateMachine:idseq-swipe-#{stage}-short-read-mngs-wdl")
      find_or_create(:app_config, key: AppConfig::SFN_MNGS_ARN, value: "arn:aws:states:us-west-2:#{account_id}:stateMachine:idseq-swipe-#{stage}-short-read-mngs-wdl")
      find_or_create(:app_config, key: AppConfig::SFN_CG_ARN, value: "arn:aws:states:us-west-2:#{account_id}:stateMachine:idseq-swipe-#{stage}-default-wdl")
    end

    def workflow_versions
      workflow_versions = {
        "consensus-genome" => "3.4.18",
        "short-read-mngs" => "8.3.3",
        "phylotree-ng" => "6.11.0",
        "amr" => "1.2.5",
        "long-read-mngs" => "0.7.3",
      }

      workflow_versions.each do |workflow, version|
        find_or_create(:app_config, key: "#{workflow}-version", value: version)
        find_or_create(:workflow_version, workflow: workflow.underscore, version: version)
      end
    end

    def alignment_config
      find_or_create(:app_config, key: AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME, value: CURRENT_ALIGNMENT_CONFIG_NAME)
      find_or_create(:workflow_version, workflow: AlignmentConfig::NCBI_INDEX, version: "2021-01-22")
    end

    def launched_features
      features = [
        "bulk_downloads",
        "sample_type_free_text",
        "host_genome_free_text",
        "heatmap_filter_fe",
        "mass_normalized",
        "plqc",
        "consensus_genome",
        "cg_bulk_downloads",
        "nextclade",
        "gen_viral_cg",
        "nanopore",
        "nanopore_v1",
        "cg_flat_list",
        "phylo_tree_ng",
        "improved_bg_model_selection",
        "landing_v2",
        "taxon_heatmap_presets",
        "blast",
        "annotation",
        "heatmap_pin_samples",
        "sorting_v0",
        "taxon_threshold_filter",
        "microbiome",
        "annotation_filter",
        "blast_v1",
        "pre_upload_check",
        "heatmap_elasticsearch",
        "samples_table_metadata_columns",
        "ont_v1",
        "bulk_deletion",
        "left_heatmap_filters",
        "amr_v3",
        "amr_v2",
        "amr_v1",
        "wgs_cg_upload",
      ]

      find_or_create(:app_config, key: AppConfig::LAUNCHED_FEATURES, value: features.to_json)
    end
  end
end

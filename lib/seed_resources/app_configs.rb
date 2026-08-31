require 'factory_bot'
require_relative 'seed_resource'

module SeedResource
  class AppConfigs < Base
    CURRENT_ALIGNMENT_CONFIG_NAME = "2024-02-06".freeze

    # SMP-1709 -- deployment stages where self-service signup is left ENABLED. Everything else
    # (beta/staging/prod, and any unrecognised stage) is seeded OFF, so signup is fail-closed by
    # default and only the dev stage can self-register.
    SELF_SERVICE_SIGNUP_STAGES = %w[dev].freeze

    def seed
      launched_features
      workflow_versions
      sfn_configs
      alignment_config
      export_control_flags
      self_service_signup_flag
    end

    private

    # SMP-1709 -- seed the self-service-signup gate EXPLICITLY per deployment stage so its state is
    # never implicit: "1" (enabled) in the dev stage, "0" (disabled) in every gated env
    # (beta/staging/prod). Stage is derived from ENV["ENVIRONMENT"] (the same var sfn_configs uses),
    # defaulting to "dev" so local/dev seeding keeps signup on. find_or_create matches on `key` and
    # never overwrites, so a value an operator set out-of-band (e.g. temporarily enabling signup in
    # a gated env) survives a re-seed. The app default is ALSO fail-closed (absent => disabled), so
    # even an unseeded env has signup off.
    def self_service_signup_flag
      stage = ENV["ENVIRONMENT"].presence || "dev"
      enabled = SELF_SERVICE_SIGNUP_STAGES.include?(stage)
      find_or_create(:app_config, key: AppConfig::SELF_SERVICE_SIGNUP_ENABLED, value: enabled ? "1" : "0")
    end

    # SMP-1686 -- seed the Descartes / export-control Layer 3 gate + tuning rows so their operational
    # state is EXPLICIT in every environment (previously no app_configs row existed for any of them; the
    # code defaults are safe -- absent == OFF -- but nothing was seeded, so the state was implicit).
    #
    # This must NEVER flip anything on: every gate flag seeds to "0" (OFF) and every tuning row to its
    # conservative default ("hold" for hit-handling, "" otherwise). find_or_create matches AppConfig on
    # `key` and returns the existing row untouched (config/initializers/factory_bot.rb), so a re-seed
    # NEVER overwrites a value someone deliberately set -- a flag turned on out-of-band stays on. Safe to
    # run repeatedly (the chart runs db:seed in the migrate PreSync hook on every deploy).
    #
    # DESCARTES_RESOLUTION_POLL_CURSOR is intentionally NOT seeded: it is a watermark the poller manages,
    # and an empty/unset cursor means "first poll uses the API default 24h look-back" (see AppConfig).
    def export_control_flags
      # Gate flags -- all seed OFF ("0"). ENABLE_EXPORT_CONTROL_LAYER3 is the master gate.
      export_control_gate_flags = [
        AppConfig::ENABLE_EXPORT_CONTROL_LAYER3,
        AppConfig::ENABLE_EXPORT_CONTROL_SCREEN_ONBOARDING,
        AppConfig::ENABLE_EXPORT_CONTROL_SCREEN_RELEASE,
        AppConfig::ENABLE_DESCARTES_SCREENING,
        AppConfig::ENABLE_EXPORT_CONTROL_ATTESTATION,
        AppConfig::ENABLE_EXPORT_CONTROL_DEVICE_ATTESTATION,
      ]
      export_control_gate_flags.each do |key|
        find_or_create(:app_config, key: key, value: "0")
      end

      # Tuning rows -- conservative / fail-closed defaults (see AppConfig for how each is interpreted):
      #   RPS_GROUPS            "" => Descartes profile default
      #   SCREENING_WHITELIST   "" => nobody whitelisted
      #   RESCREEN_CADENCE_DAYS "0" => always re-screen
      #   HIT_HANDLING          "hold" => place a hold and await human adjudication (never "allow")
      find_or_create(:app_config, key: AppConfig::EXPORT_CONTROL_RPS_GROUPS, value: "")
      find_or_create(:app_config, key: AppConfig::EXPORT_CONTROL_SCREENING_WHITELIST, value: "")
      find_or_create(:app_config, key: AppConfig::EXPORT_CONTROL_RESCREEN_CADENCE_DAYS, value: "0")
      find_or_create(:app_config, key: AppConfig::EXPORT_CONTROL_HIT_HANDLING, value: "hold")
    end

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
      # SWIPE app_name namespace. Legacy is idseq-swipe-<stage>; a fresh seqtoid env whose swipe is
      # named seqtoid-swipe-<stage> (isolated from a live legacy idseq-swipe-<stage> in the same
      # account) sets SWIPE_APP_NAME via Chamber. Default keeps existing envs byte-identical.
      swipe_app_name = ENV["SWIPE_APP_NAME"].presence || "idseq-swipe-#{stage}"
      find_or_create(:app_config, key: AppConfig::SFN_SINGLE_WDL_ARN, value: "arn:aws:states:us-west-2:#{account_id}:stateMachine:#{swipe_app_name}-default-wdl")
      find_or_create(:app_config, key: AppConfig::ENABLE_SFN_NOTIFICATIONS, value: "1")

      find_or_create(:app_config, key: AppConfig::SFN_ARN, value: "arn:aws:states:us-west-2:#{account_id}:stateMachine:#{swipe_app_name}-short-read-mngs-wdl")
      find_or_create(:app_config, key: AppConfig::SFN_MNGS_ARN, value: "arn:aws:states:us-west-2:#{account_id}:stateMachine:#{swipe_app_name}-short-read-mngs-wdl")
      find_or_create(:app_config, key: AppConfig::SFN_CG_ARN, value: "arn:aws:states:us-west-2:#{account_id}:stateMachine:#{swipe_app_name}-default-wdl")
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

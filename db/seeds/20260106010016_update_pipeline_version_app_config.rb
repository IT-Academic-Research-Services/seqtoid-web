class UpdatePipelineVersionAppConfig < SeedMigration::Migration
  # The workflow versions this migration registers. Kept as data so up/down stay in step.
  VERSIONS = [
    ["amr", "1.4.2"],
    ["consensus-genome", "3.5.5"],
    ["long-read-mngs", "0.7.12"],
    ["short-read-mngs", "8.3.15"],
  ].freeze

  def up
    AppConfigHelper.set_app_config("consensus-genome-version", "3.5.5")
    AppConfigHelper.set_app_config("long-read-mngs-version", "0.7.12")
    AppConfigHelper.set_app_config("short-read-mngs-version", "8.3.15")

    # find_or_create_by, NOT a raw create. seed:migrate now runs in the sandbox/reconstitute migrate
    # hook, so this migration can be applied against an env whose catalog already holds some of these
    # rows (the [workflow, version] index is unique). A raw create raises RecordNotUnique there and
    # fails the whole migrate hook; idempotent creation keeps it safe to apply on any DB state.
    VERSIONS.each do |workflow, version|
      WorkflowVersion.find_or_create_by(workflow: workflow, version: version) do |wv|
        wv.deprecated = false
        wv.runnable = true
      end
    end
  end

  def down
    AppConfigHelper.set_app_config("consensus-genome-version", "3.5.1")
    AppConfigHelper.set_app_config("long-read-mngs-version", "0.7.11")
    AppConfigHelper.set_app_config("short-read-mngs-version", "8.3.11")

    VERSIONS.each do |workflow, version|
      WorkflowVersion.find_by(workflow: workflow, version: version)&.destroy
    end
  end
end

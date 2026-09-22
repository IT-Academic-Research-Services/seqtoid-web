class UpdatePipelineVersionAppConfig < SeedMigration::Migration
  # The workflow versions this migration registers. Kept as data so up/down stay in step.
  VERSIONS = [
    ["amr", "1.4.2"],
    ["consensus-genome", "3.5.5"],
    ["long-read-mngs", "0.7.12"],
    ["short-read-mngs", "8.3.15"],
  ].freeze

  def up
    # SMP-1724 -- seed_workflow_version is non-downgrading: it sets each `*-version` app_config only
    # when the env has no value yet or is on an OLDER version, and preserves a live value that was
    # already bumped past this (stale) seed snapshot. seed:migrate runs in the migrate PreSync hook
    # on every deploy/reconstitute, so a raw set_app_config here would silently revert a hand-bumped
    # default (e.g. short-read-mngs 8.3.16 -> 8.3.15) and dispatch the old WDL. It also catalogues
    # whatever value ends up live, so the [workflow, version] catalog row is guaranteed (idempotent
    # against the unique index) and VersionRetrievalService never fail-closes on the default.
    VERSIONS.each do |workflow, version|
      AppConfigHelper.seed_workflow_version(workflow, version) unless workflow == "amr"
    end
    # amr has no `*-version` app_config default set here; only register its catalog row (idempotent).
    AppConfigHelper.create_workflow_version("amr", "1.4.2")
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

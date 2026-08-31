class UpdatePipelineVersionAppConfig < SeedMigration::Migration
  def up
    # SMP-1724 -- non-downgrading: seed:migrate re-applies this against live envs, and a raw update
    # would revert a bumped default back to this stale value. seed_workflow_version only advances an
    # older/absent value and catalogues whatever ends up live.
    AppConfigHelper.seed_workflow_version("consensus-genome", "3.5.1")
    AppConfigHelper.seed_workflow_version("long-read-mngs", "0.7.8")
  end

  def down
    AppConfig.find_by(key: "consensus-genome-version").update(value: "3.4.18")
    WorkflowVersion.find_by(version: "3.5.1", workflow: "consensus_genome").destroy

    AppConfig.find_by(key: "long-read-mngs-version").update(value: "0.7.3")
    WorkflowVersion.find_by(version: "0.7.8", workflow: "long_read_mngs").destroy
  end
end

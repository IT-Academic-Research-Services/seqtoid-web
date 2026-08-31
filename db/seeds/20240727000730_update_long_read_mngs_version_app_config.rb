class UpdateLongReadMngsVersionAppConfig < SeedMigration::Migration
  def up
    # SMP-1724 -- non-downgrading re-seed; only advances an older/absent default and catalogues it.
    AppConfigHelper.seed_workflow_version("long-read-mngs", "0.7.11")
  end

  def down
    AppConfigHelper.set_app_config("long-read-mngs-version", "0.7.8")
  end
end

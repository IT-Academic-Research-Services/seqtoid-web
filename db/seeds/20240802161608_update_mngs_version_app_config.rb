class UpdateMngsVersionAppConfig < SeedMigration::Migration
  def up
    # SMP-1724 -- non-downgrading re-seed; only advances an older/absent default and catalogues it.
    AppConfigHelper.seed_workflow_version("short-read-mngs", "8.3.11")
  end

  def down
    AppConfigHelper.set_app_config("short-read-mngs-version", "8.3.3")
  end
end

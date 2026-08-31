class UpdateAmrVersion < SeedMigration::Migration
  def up
    # SMP-1724 -- non-downgrading re-seed; only advances an older/absent default and catalogues it.
    AppConfigHelper.seed_workflow_version("amr", "1.4.2")
  end

  def down
    AppConfigHelper.set_app_config("amr-version", "1.2.5")
  end
end

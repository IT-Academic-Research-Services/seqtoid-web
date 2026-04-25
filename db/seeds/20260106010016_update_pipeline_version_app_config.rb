class UpdatePipelineVersionAppConfig < SeedMigration::Migration
  def up
    AppConfigHelper.set_app_config("consensus-genome-version", "3.5.5")
  end

  def down
    AppConfigHelper.set_app_config("consensus-genome-version", "3.5.1")
  end
end

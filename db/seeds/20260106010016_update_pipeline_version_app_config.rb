class UpdatePipelineVersionAppConfig < SeedMigration::Migration
  def up
    AppConfigHelper.set_app_config("consensus-genome-version", "3.5.5")
    AppConfigHelper.set_app_config("long-read-mngs-version", "0.7.12")
    AppConfigHelper.set_app_config("short-read-mngs-version", "8.3.15")

    WorkflowVersion.create({ :deprecated => false, :runnable => true, :version => "1.4.2", :workflow => "amr" })
    WorkflowVersion.create({ :deprecated => false, :runnable => true, :version => "3.5.5", :workflow => "consensus-genome" })
    WorkflowVersion.create({ :deprecated => false, :runnable => true, :version => "0.7.12", :workflow => "long-read-mngs" })
    WorkflowVersion.create({ :deprecated => false, :runnable => true, :version => "8.3.15", :workflow => "short-read-mngs" })
  end

  def down
    AppConfigHelper.set_app_config("consensus-genome-version", "3.5.1")
    AppConfigHelper.set_app_config("long-read-mngs-version", "0.7.11")
    AppConfigHelper.set_app_config("short-read-mngs-version", "8.3.11")

    WorkflowVersion.find_by(version: "1.4.2", workflow: "amr")&.destroy
    WorkflowVersion.find_by(version: "3.5.5", workflow: "consensus-genome")&.destroy
    WorkflowVersion.find_by(version: "0.7.12", workflow: "long-read-mngs")&.destroy
    WorkflowVersion.find_by(version: "8.3.15", workflow: "short-read-mng")&.destroy
  end
end

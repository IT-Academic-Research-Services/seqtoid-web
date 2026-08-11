class RemoveStaticPathogens < SeedMigration::Migration
  def up
    obsolete_pathogen_list_version = "1.0.0"
    Rails.logger.info("Deleting pathogen_list_version: #{obsolete_pathogen_list_version}")
    pathogen_list_version = PathogenListVersion.find_by(version: obsolete_pathogen_list_version)
    pathogen_list_version&.destroy!
  end

  def down
    obsolete_pathogen_list_version = "1.0.0"
    Rails.logger.info("Cannot undo deletion of pathogen_list_version: #{obsolete_pathogen_list_version}")
  end
end

# When this account passed Visual Compliance screening (the website sign-up form). Project sharing only
# adds accounts that have it (ProjectsController#add_user), because sharing used to create accounts with no
# screening at all. Set by ProvisionScreenedAccountJob on an approved screen, including for an account that
# already existed; existing accounts are backfilled by rake export_control:backfill_cleared. NULL = this
# account has not passed screening.
class AddExportControlClearedAtToUsers < ActiveRecord::Migration[7.2]
  COMMENT = "When this account passed Visual Compliance screening. NULL = not screened/cleared; project sharing refuses it.".freeze

  def change
    add_column :users, :export_control_cleared_at, :datetime, null: true, if_not_exists: true, comment: COMMENT
  end
end

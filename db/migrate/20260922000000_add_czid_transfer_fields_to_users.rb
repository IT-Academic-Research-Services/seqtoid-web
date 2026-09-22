# frozen_string_literal: true

# CZ ID data-transfer request captured at registration (SMP-1901): whether the user wants their
# existing CZ ID data transferred, and the email on their CZ ID account (may differ from the email
# they register with, so it is captured separately). Both additive -- boolean defaulted, string
# nullable -- no backfill needed (existing rows never made the request).
class AddCzidTransferFieldsToUsers < ActiveRecord::Migration[7.2]
  # Plain add_column (NOT a bulk change_table): strong_migrations cannot inspect a change_table block
  # and would force a safety_assured wrapper, whereas each add_column here is statically verified safe.
  # if_not_exists keeps the migration re-runnable (bin/ci-migrate-check replays a partial-apply state).
  # rubocop:disable Rails/BulkChangeTable
  def change
    add_column :users, :wants_czid_data_transferred, :boolean, default: false, null: false, if_not_exists: true
    add_column :users, :czid_account_email, :string,
               comment: "Email on the user's existing CZ ID account, for the data-transfer request (SMP-1901). May differ from :email.",
               if_not_exists: true
  end
  # rubocop:enable Rails/BulkChangeTable
end

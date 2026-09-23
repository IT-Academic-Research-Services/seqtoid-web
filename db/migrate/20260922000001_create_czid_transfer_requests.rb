# frozen_string_literal: true

# SMP-1901 -- local sidecar for the pre-account CZ ID data-transfer request. It is captured on the
# anonymous export-control signup form (where no User exists yet), copied onto the User at provisioning,
# and then deleted. It lives entirely in seqtoid-web's own database and DELIBERATELY never travels through
# the export-control screening payload. Keyed by the normalized (stripped + downcased) signup email so
# provisioning can look it up by the email the account is created with.
class CreateCzidTransferRequests < ActiveRecord::Migration[7.2]
  # A brand-new table: create_table (with the index declared inside the block, so strong_migrations does
  # not see a separate add_index on an existing table). if_not_exists keeps it re-runnable for
  # bin/ci-migrate-check.
  def change
    # Explicit charset (matches the primary app DB default + the users table where these fields permanently
    # live), so the migration is deterministic and the CI schema-parity check does not depend on the DB's
    # default charset.
    create_table :czid_transfer_requests, charset: "utf8mb3", collation: "utf8mb3_unicode_ci",
                                          if_not_exists: true do |t|
      t.string :email, null: false,
               comment: "Normalized (stripped + downcased) signup email; the key provisioning looks up."
      t.boolean :wants_czid_data_transferred, null: false, default: false
      t.string :czid_account_email,
               comment: "Email on the applicant's existing CZ ID account for the transfer (may differ from :email)."
      # Explicit precision: 6 (like create_pending_signups) so the dumped schema is deterministic and does
      # not depend on the bare-t.timestamps default -- it dumps without a precision annotation, matching
      # the recent sibling tables.
      t.timestamps precision: 6
      t.index :email, unique: true
    end
  end
end

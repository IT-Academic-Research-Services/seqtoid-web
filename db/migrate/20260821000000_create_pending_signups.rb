# frozen_string_literal: true

# Option A / piece 5b -- pending-signup HOLD table (see app/models/pending_signup.rb). One row per applicant
# whose signup is being screened and did NOT auto-approve; it holds the account identity to build once a
# decision lands. ADDITIVE ONLY. Inert until the screening feature is enabled behind its OFF-by-default flags.
#
# This is the PRIMARY-connection copy so the single-DB envs (dev / test / the web app) carry the table in
# db/schema.rb exactly like screening_results / holds. The screening-service role builds its own ISOLATED
# copy from db/screening_migrate against the dedicated screening cluster (PendingSignup routes there via
# the `screening` connection).
class CreatePendingSignups < ActiveRecord::Migration[7.2]
  def change
    # if_not_exists keeps the migration self-healing on a partial apply (same pattern as the CZID-597
    # create_table migrations + bin/ci-migrate-check's re-run pass).
    create_table :pending_signups, charset: "utf8mb4", collation: "utf8mb4_unicode_ci", if_not_exists: true do |t|
      # Correlation key -- equals the screen's subject_ref / correlation_id ("User:<token>"), so the
      # resolution poller can find the held signup for a resolved hold.
      t.string :subject_ref, null: false
      # The screening_id echoed back on the decision callback.
      t.string :screening_id
      # Where the service POSTs the approved/denied decision (the web app's callback endpoint).
      t.text :callback_url

      # Applicant identity held for account creation -- app-layer ENCRYPTED (ActiveRecord::Encryption).
      # text because the encrypted ciphertext is materially longer than the plaintext.
      t.text :account_email
      t.text :account_name
      t.text :account_institution

      # pending -> resolved once the decision callback has been posted.
      t.string :status, null: false, default: "pending"
      # The decision we posted (approved / denied), for the audit trail.
      t.string :decision
      t.datetime :resolved_at

      t.timestamps precision: 6
    end

    # "the still-pending signup for this subject" lookup (PendingSignup.pending_for).
    add_index :pending_signups, [:subject_ref, :status], if_not_exists: true
  end
end

# frozen_string_literal: true

# Option A / piece 5b -- the screening service's copy of pending_signups, applied by the `screening`
# connection to the ISOLATED screening cluster (service role only). Mirrors the primary-connection
# migration (db/migrate/20260821000000) so the isolated store carries the held applicant records. See
# app/models/pending_signup.rb. if_not_exists so it is a safe no-op where the connection aliases the
# primary DB.
class CreatePendingSignups < ActiveRecord::Migration[7.2]
  def change
    create_table :pending_signups, charset: "utf8mb4", collation: "utf8mb4_unicode_ci", if_not_exists: true do |t|
      t.string :subject_ref, null: false
      t.string :screening_id
      t.text :callback_url
      # App-layer encrypted (ActiveRecord::Encryption); text because ciphertext exceeds the plaintext.
      t.text :account_email
      t.text :account_name
      t.text :account_institution
      t.string :status, null: false, default: "pending"
      t.string :decision
      t.datetime :resolved_at
      t.timestamps precision: 6
    end

    add_index :pending_signups, [:subject_ref, :status], if_not_exists: true
  end
end

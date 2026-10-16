# Denied applicants are ARCHIVED here instead of being dropped (Tom, 2026-10-16: "if someone is denied, they
# should be moved to a different table vs the primary visual compliance user table"). A denied signup's
# identity was previously lost: the auto-deny path never persisted it, the officer-deny path left it as a
# resolved pending_signups row, and the web app deleted the applicant's CZ ID transfer request. This table
# keeps the applicant identity (app-layer encrypted, like pending_signups), the reason, who decided, and the
# links to the screening evidence -- retained under the screening store's 10-year backup plan.
class CreateDeniedSignups < ActiveRecord::Migration[7.2]
  def change
    create_table :denied_signups, charset: "utf8mb4", collation: "utf8mb4_unicode_ci", if_not_exists: true do |t|
      t.string :subject_ref, null: false
      t.string :screening_id
      t.text :callback_url
      t.text :account_email
      t.text :account_name
      t.text :account_institution
      t.string :reason, null: false
      t.string :decided_by, null: false
      t.string :resolution_status
      t.bigint :screening_result_id
      t.bigint :hold_id
      t.bigint :pending_signup_id
      t.datetime :denied_at, null: false
      t.datetime :reinstated_at
      t.string :reinstated_by
      t.timestamps precision: 6
    end
    add_index :denied_signups, :subject_ref, if_not_exists: true
  end
end

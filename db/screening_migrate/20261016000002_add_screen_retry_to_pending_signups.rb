# Automatic re-screen of a signup whose Descartes screen errored (timeout/transport/vendor error). A
# fail-closed error hold means Visual Compliance never screened the applicant, and nobody ever re-screened
# a signup -- the hold sat until an operator released it by hand. To re-screen later the service needs the
# screened party's details (name/address/country, app-layer encrypted like the account fields) plus the
# table-keyed soptionalid, and a small attempt counter for backoff.
class AddScreenRetryToPendingSignups < ActiveRecord::Migration[7.2]
  def change
    add_column :pending_signups, :subject_payload, :text, if_not_exists: true
    add_column :pending_signups, :soptionalid, :string, if_not_exists: true
    add_column :pending_signups, :screen_attempts, :integer, default: 0, null: false, if_not_exists: true
    add_column :pending_signups, :last_screen_attempt_at, :datetime, if_not_exists: true
  end
end

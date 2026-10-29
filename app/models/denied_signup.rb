# frozen_string_literal: true

# A DENIED applicant signup, archived instead of dropped. Lives in the screening service's own, isolated
# database (via ScreeningRecord); the applicant identity fields are encrypted at the application layer,
# exactly like PendingSignup.
#
# Why: a denied applicant's identity used to vanish. The sanctioned-jurisdiction auto-deny never persisted
# the applicant at all, an officer True Hit left only a resolved pending_signups row, and the web app
# deleted the applicant's CZ ID transfer request. Denials are compliance records, so they are kept here
# (under the screening store's 10-year backup retention) with the reason, who decided, and the links to the
# screening evidence. A pending signup that is denied is MOVED here (see PendingSignup#archive_denied!),
# keeping pending_signups to applicants who are still in flight or were approved.
#
# reinstated_at / reinstated_by record a later reversal (a compliance officer clearing a case that was
# auto-denied); the row is kept as history either way.
class DeniedSignup < ScreeningRecord
  DECIDED_BY_AUTO = "auto"
  DECIDED_BY_OFFICER = "officer"
  DECIDED_BY = [DECIDED_BY_AUTO, DECIDED_BY_OFFICER].freeze

  encrypts :account_email
  encrypts :account_name
  encrypts :account_institution

  validates :subject_ref, presence: true
  validates :reason, presence: true
  validates :decided_by, inclusion: { in: DECIDED_BY }
  validates :denied_at, presence: true

  scope :for_subject, ->(ref) { where(subject_ref: ref) }
  scope :not_reinstated, -> { where(reinstated_at: nil) }

  # Archive a denial for a subject. Idempotent: a replayed deny for the same subject updates the existing
  # not-yet-reinstated row instead of stacking duplicates (one applicant, one open denial).
  def self.archive!(subject_ref:, reason:, decided_by:, account: nil, screening_id: nil, callback_url: nil,
                    resolution_status: nil, screening_result_id: nil, hold_id: nil, pending_signup_id: nil,
                    at: Time.current)
    account ||= {}
    row = for_subject(subject_ref).not_reinstated.order(id: :desc).first || new(subject_ref: subject_ref)
    row.assign_attributes(
      reason: reason,
      decided_by: decided_by,
      screening_id: screening_id || row.screening_id,
      callback_url: callback_url || row.callback_url,
      resolution_status: resolution_status,
      screening_result_id: screening_result_id || row.screening_result_id,
      hold_id: hold_id || row.hold_id,
      pending_signup_id: pending_signup_id || row.pending_signup_id,
      account_email: account["email"] || account[:email] || row.account_email,
      account_name: account["name"] || account[:name] || row.account_name,
      account_institution: account["institution"] || account[:institution] || row.account_institution,
      denied_at: row.denied_at || at
    )
    row.save!
    row
  end

  # The account payload to hand back on an approval callback if this denial is reversed.
  def account_payload
    { "email" => account_email, "name" => account_name, "institution" => account_institution }.compact
  end

  def reinstated?
    reinstated_at.present?
  end
end

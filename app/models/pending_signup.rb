# frozen_string_literal: true

# Option A / piece 5b -- the applicant account data HELD while a signup is being screened, so that when a
# decision lands (auto on a solid pass, or later when a compliance officer adjudicates the hold) the
# service can drive the account-provisioning callback WITHOUT the original request still being in flight.
#
# Tom's spec: the create-account form's data does two things -- (a) go to Visual Compliance to screen,
# (b) be HELD so the account can be built once approved. This model is (b). It lives in the screening
# service's OWN, ISOLATED database (via ScreeningRecord); the applicant identity fields are additionally
# encrypted at the application layer (ActiveRecord::Encryption) on top of the store's at-rest KMS
# encryption, because a pending signup is unverified third-party PII with a short life.
#
# Lifecycle: ProcessScreeningJob writes a PENDING row when a screen does NOT auto-approve (held/error).
# ResolveScreeningHolds (the IM resolution poller) posts the approved/denied callback to the web app when
# the officer's verdict arrives: an approval marks the row RESOLVED; a denial MOVES it to denied_signups
# (DeniedSignup) so the denied applicant is retained as a compliance record. Auto-approved signups never
# create a row (the callback fires inline). Nothing here is exercised until the screening feature is
# enabled behind its OFF-by-default flags.
class PendingSignup < ScreeningRecord
  STATUS_PENDING = "pending".freeze
  STATUS_RESOLVED = "resolved".freeze
  STATUSES = [STATUS_PENDING, STATUS_RESOLVED].freeze

  DECISION_APPROVED = "approved".freeze
  DECISION_DENIED = "denied".freeze

  # Applicant identity held for account creation. Encrypted at the app layer; :support_unencrypted_data is
  # enabled globally so a row written before keys are configured (the dark state) still reads back.
  encrypts :account_email
  encrypts :account_name
  encrypts :account_institution

  validates :subject_ref, presence: true
  validates :status, inclusion: { in: STATUSES }

  scope :pending, -> { where(status: STATUS_PENDING) }
  scope :for_subject, ->(ref) { where(subject_ref: ref) }

  # The single still-pending signup for a subject (the one a verdict resolves), or nil.
  def self.pending_for(subject_ref)
    for_subject(subject_ref).pending.order(id: :desc).first
  end

  # Idempotently hold a signup for a subject. A replayed screen for the same subject updates the existing
  # pending row rather than stacking duplicates (one applicant, one pending signup).
  def self.hold!(subject_ref:, screening_id:, callback_url:, account:)
    account ||= {}
    row = pending_for(subject_ref) || new(subject_ref: subject_ref)
    row.assign_attributes(
      screening_id: screening_id,
      callback_url: callback_url,
      status: STATUS_PENDING,
      account_email: account["email"] || account[:email],
      account_name: account["name"] || account[:name],
      account_institution: account["institution"] || account[:institution]
    )
    row.save!
    row
  end

  # The account payload to hand back on the approval callback (only the fields the web app seeds from).
  def account_payload
    { "email" => account_email, "name" => account_name, "institution" => account_institution }.compact
  end

  # Move a DENIED signup out of pending_signups into the denied_signups archive, in one transaction, so the
  # applicant identity is kept (as a compliance record) rather than lingering as a resolved row here or
  # being lost. Returns the DeniedSignup.
  def archive_denied!(reason:, decided_by:, resolution_status: nil, screening_result_id: nil, hold_id: nil)
    self.class.transaction do
      denied = DeniedSignup.archive!(
        subject_ref: subject_ref,
        reason: reason,
        decided_by: decided_by,
        account: account_payload,
        screening_id: screening_id,
        callback_url: callback_url,
        resolution_status: resolution_status,
        screening_result_id: screening_result_id,
        hold_id: hold_id,
        pending_signup_id: id
      )
      destroy!
      denied
    end
  end

  # Mark this signup resolved once its decision callback has been posted. Idempotent -- keeps the first
  # resolution so a re-poll of the same verdict does not churn the row or re-post.
  def resolve!(decision:, at: Time.current)
    return true unless status == STATUS_PENDING

    update!(status: STATUS_RESOLVED, decision: decision, resolved_at: at)
  end
end

# CZID-597 (Export-control Layer 3 / #285) -- a restricted-party HOLD on a subject/item, placed when a
# Descartes screen HITS (or the screen fails-closed on error/timeout). Released only after a human
# compliance officer adjudicates. Written by the ScreeningService (CZID-596); inert until that service is
# enabled behind its OFF-by-default flag.
class Hold < ScreeningRecord
  # Why a hold was placed. Kept explicit so the record is self-describing.
  REASON_SCREENING_HIT = "screening_hit".freeze # a real alert-level match
  REASON_SCREENING_ERROR = "screening_error".freeze # fail-closed: vendor error/timeout/misconfig
  # Zero-tolerance geo rule: the screened party is associated with a sanctioned jurisdiction (our
  # in-house embargo list or the vendor's risk_country flag). A hard HOLD regardless of name-match.
  REASON_SANCTIONED_JURISDICTION = "sanctioned_jurisdiction".freeze
  REASONS = [REASON_SCREENING_HIT, REASON_SCREENING_ERROR, REASON_SANCTIONED_JURISDICTION].freeze

  # Terminal IM adjudication outcomes recorded on the hold (SMP-1253 audit trail).
  DISPOSITION_RELEASED = "released".freeze
  DISPOSITION_DENIED = "denied".freeze
  DISPOSITIONS = [DISPOSITION_RELEASED, DISPOSITION_DENIED].freeze

  # The screen that triggered the hold. Optional: a fail-closed error may have no persisted screen row.
  belongs_to :screening_result, optional: true

  validates :subject_ref, presence: true
  validates :reason, inclusion: { in: REASONS }

  # SMP-1687: the moment a hold is durably committed, notify the compliance administrator -- a hit is an
  # adjudication task, a fail-closed error is an operational incident. Without this a hold is SILENT and
  # the blocked user waits indefinitely. after_create_commit so a rolled-back hold never notifies; the
  # notifier is INERT when no recipient is configured and INERT-SAFE (never raises back into the
  # screening path), matching the screening core's off-by-default, fail-closed posture.
  after_create_commit { ExportControl::ComplianceNotifier.notify_hold(self) }

  # Still-in-force holds (not yet released), and the per-subject filter.
  scope :active, -> { where(released_at: nil) }
  scope :released, -> { where.not(released_at: nil) }
  scope :for_subject, ->(ref) { where(subject_ref: ref) }

  # True while the hold is in force.
  def active?
    released_at.nil?
  end

  # True once a terminal IM verdict has been recorded on the hold (released OR denied).
  # A hold can be adjudicated?=true yet still active? (a True Hit stays in force).
  def adjudicated?
    resolved_at.present?
  end

  # Mark the hold released after a terminal-clear IM verdict. Idempotent -- keeps the
  # first release, so a re-poll of the same verdict does not churn the row.
  #
  # resolution_status (the raw IM verdict) and incident_id (the resolving IM record)
  # make the human adjudication a DURABLE record on the hold, not just a timestamp
  # plus an ephemeral log line (SMP-1253). resolved_at mirrors released_at here.
  def release!(at: Time.current, resolution_status: nil, incident_id: nil)
    return true unless active?

    update!(
      released_at: at,
      resolved_at: at,
      disposition: DISPOSITION_RELEASED,
      resolution_status: resolution_status,
      incident_id: incident_id
    )
  end

  # Record a terminal DENY (IM True Hit). The hold STAYS in force (released_at nil) but
  # the adjudication becomes a durable record -- reviewed-and-denied, not indistinguishable
  # from never-reviewed. Idempotent: only the first terminal verdict is recorded, and this
  # NEVER releases the hold.
  def deny!(at: Time.current, resolution_status: nil, incident_id: nil)
    return true if adjudicated?

    update!(
      resolved_at: at,
      disposition: DISPOSITION_DENIED,
      resolution_status: resolution_status,
      incident_id: incident_id
    )
  end
end

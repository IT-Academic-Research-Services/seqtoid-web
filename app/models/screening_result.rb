# CZID-597 (Export-control Layer 3 / #285) -- one row per Descartes restricted-party screen of a subject.
# Append-only evidence record (see the migration). The Descartes ScreeningService (CZID-596) writes here;
# nothing writes here until that service is enabled behind its OFF-by-default flag.
#
# Two signals from a Descartes SearchEntity screen:
#   - transstatus (PRIMARY): "Passed" or "On Hold-RPS" -- Descartes' own transaction-level on-hold
#     determination. The release/hold decision keys off THIS first. Fail-closed: anything that is not
#     exactly "Passed" holds (blank / unknown / "On Hold-RPS" all hold).
#   - alert_level (SEVERITY detail): nomatch/wl/al are clean-or-allow-listed; yellow/red/double_red/
#     triple_red describe HOW BAD a match is, for the human compliance officer. Secondary to transstatus.
class ScreeningResult < ApplicationRecord
  # --- transstatus (primary signal) ---
  TRANSSTATUS_PASSED  = "Passed".freeze
  TRANSSTATUS_ON_HOLD = "On Hold-RPS".freeze

  # --- Descartes alert levels (severity detail) ---
  ALERT_NOMATCH     = "nomatch".freeze     # clean, no match
  ALERT_WL          = "wl".freeze          # whitelist (known-good, allowed)
  ALERT_AL          = "al".freeze          # allowed-list (allowed)
  ALERT_YELLOW      = "yellow".freeze      # name-only match -> adjudicate
  ALERT_RED         = "red".freeze         # match -> adjudicate
  ALERT_DOUBLE_RED  = "double_red".freeze  # stronger match -> adjudicate
  ALERT_TRIPLE_RED  = "triple_red".freeze  # strongest match -> adjudicate
  ALERT_LEVELS = [
    ALERT_NOMATCH, ALERT_WL, ALERT_AL,
    ALERT_YELLOW, ALERT_RED, ALERT_DOUBLE_RED, ALERT_TRIPLE_RED,
  ].freeze

  # Alert levels that describe a clean-or-allow-listed party (severity view). NOT the primary decision --
  # transstatus is. Used only for the severity-side helper alert_allowed?.
  ALLOWED_LEVELS = [ALERT_NOMATCH, ALERT_WL, ALERT_AL].freeze

  # A hold whose trigger was this screen. Nullable inverse (a screen may have no hold).
  has_many :holds, dependent: :restrict_with_exception

  validates :subject_ref, presence: true
  validates :alert_level, inclusion: { in: ALERT_LEVELS }
  validates :screened_at, presence: true

  # Latest-first ordering + "the latest screen for a given subject".
  scope :for_subject, ->(ref) { where(subject_ref: ref) }
  scope :latest_first, -> { order(screened_at: :desc, id: :desc) }

  # The single most-recent screening row for a subject, or nil.
  def self.latest_for(subject_ref)
    for_subject(subject_ref).latest_first.first
  end

  # PRIMARY release decision: only an exact "Passed" transstatus passes. Fail-closed -- blank / unknown /
  # "On Hold-RPS" all return false.
  def passed?
    transstatus == TRANSSTATUS_PASSED
  end

  # PRIMARY hold decision, transstatus-first. Fail-closed: anything not exactly "Passed" requires a hold.
  def hold_required?
    !passed?
  end

  # Severity-side helper: true only for the explicitly-allowed alert levels. Informational -- the actual
  # release decision is passed?/hold_required? (transstatus-primary), not this.
  def alert_allowed?
    ALLOWED_LEVELS.include?(alert_level)
  end

  # Effective severity for triage/display. A sanctioned-jurisdiction association (jurisdiction_risk,
  # stamped at screen time from our embargo list or the vendor's risk_country) is RED regardless of the
  # vendor's name-match severity -- the zero-tolerance geo rule. Otherwise the vendor alert_level.
  def effective_alert_level
    jurisdiction_risk? ? ALERT_RED : alert_level
  end
end

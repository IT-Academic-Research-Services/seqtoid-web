# CZID-597 (Export-control Layer 3 / #285) -- one row per Descartes restricted-party screen of a subject.
# Append-only evidence record (see the migration). The Descartes ScreeningService (CZID-596) writes here;
# nothing writes here until that service is enabled behind its OFF-by-default flag.
#
# Two signals from a Descartes SearchEntity screen:
#   - alert_level (the SearchEntity verdict): nomatch/wl/al are clean-or-allow-listed; yellow/red/
#     double_red/triple_red describe HOW BAD a name match is. On the SearchEntity/ScreenEntity call this
#     app makes, THIS is the actual clean/hit verdict.
#   - transstatus: "Passed" or "On Hold-RPS" -- a transaction-level on-hold field that Descartes populates
#     on the IMTimeStampSearch RESOLUTION call, and typically leaves BLANK on a SearchEntity screen.
# The release decision (passed?) honors transstatus when present but falls back to the alert_level verdict
# when it is blank -- otherwise a clean no-match (alert="nomatch", transstatus=nil) would be held, which is
# exactly what held every clean subject before this was fixed. Still fail-closed (see passed?).
class ScreeningResult < ScreeningRecord
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

  # Release decision. transstatus is honored when present, but a Descartes SearchEntity/ScreenEntity
  # screen (the one this app performs) returns its verdict in ALERT_LEVEL and typically leaves transstatus
  # BLANK -- "Passed"/"On Hold-RPS" is a transaction-level field of a different call (the IMTimeStampSearch
  # resolution poll). Keying release solely on transstatus therefore held EVERY subject, including clean
  # ones (production returns alert_level="nomatch" with transstatus=nil for a no-match, and the old logic
  # held them). So:
  #   - transstatus == "On Hold-RPS" -> HOLD (explicit vendor on-hold wins, even over a clean alert)
  #   - transstatus == "Passed"      -> PASS (explicit vendor pass)
  #   - transstatus blank (the norm) -> the SEVERITY is the verdict: a clean/allow-listed level with no
  #     adverse jurisdiction (effective_alert_level in ALLOWED_LEVELS = nomatch/wl/al) passes; a match
  #     (yellow/red/double_red/triple_red), an unknown level, or a sanctioned-jurisdiction association
  #     (effective_alert_level forced RED) all HOLD.
  # Still fail-closed: a pass requires an affirmative clean signal (explicit "Passed" OR an explicit
  # allow-listed no-match severity) -- never uncertainty.
  def passed?
    return false if transstatus == TRANSSTATUS_ON_HOLD
    return true if transstatus == TRANSSTATUS_PASSED

    ALLOWED_LEVELS.include?(effective_alert_level)
  end

  # Hold decision -- the inverse of the release decision above. Fail-closed: anything that is not an
  # affirmative pass holds.
  def hold_required?
    !passed?
  end

  # Severity-side helper: true for the explicitly allow-listed alert levels (raw, pre-jurisdiction). The
  # authoritative release decision is passed?/hold_required? (which uses effective_alert_level so the
  # sanctioned-jurisdiction backstop applies); this stays a plain severity view.
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

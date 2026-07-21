# frozen_string_literal: true

# CZID-598 (Export-control Layer 3 / #285) -- the Descartes Incident Manager RESOLUTION poller. This is
# the async second phase of the two-phase screening model: SearchEntity (CZID-596) places a HOLD on a
# hit; a HUMAN compliance officer then adjudicates the alert in Descartes Incident Manager; this
# scheduled Resque job polls IMTimeStampSearch on an interval, pulls the verdicts back, and RELEASES or
# KEEPS-HELD each matching hold per the IM lifecycle (API design doc #595, Section 4.3).
#
# ============================ OFF-BY-DEFAULT / SELF-SKIP ============================
# perform SELF-SKIPS (returns immediately, no network, no writes) unless BOTH:
#   1. AppConfig::ENABLE_DESCARTES_SCREENING == "1" (the same flag that gates ScreeningService), AND
#   2. the ResolutionClient is configured (endpoint + credentials present in the env).
# With the flag off -- the default -- the schedule entry fires but this job is a pure no-op, so the
# feature is indistinguishable from not existing. There is NO live release path on the default config.
#
# ============================ FAIL-CLOSED ============================
# A hold is RELEASED only on an explicit terminal-clear verdict (Cleared / False Hit / CRI Auto-Clear).
# Every other status (DS New / Actioned / Escalated / True Hit / Closed / unknown) KEEPS the hold in
# force. Any transport/parse/credential error raises out of the client and is logged; the watermark is
# NOT advanced, so the same window is re-polled next run. No verdict is ever inferred from an error.
#
# ============================ IDEMPOTENT ============================
# Re-processing the same verdict is a no-op: Hold#release! keeps the first release timestamp, and
# incident_id is written only when absent. Safe to re-run over an overlapping window.
class ResolveScreeningHolds
  extend InstrumentedJob

  @queue = :resolve_screening_holds

  # IM lifecycle status -> disposition. Only these three terminal-clear states release a hold; True Hit
  # is a terminal DENY (keep held, record); everything else (incl. unknown) is non-terminal -> keep held.
  # This mapping is policy (counsel-owned per design doc Section 6, Q4); encoded here fail-closed.
  RELEASE_STATUSES = ['Cleared', 'False Hit', 'CRI Auto-Clear'].freeze
  DENY_STATUSES = ['True Hit'].freeze

  # Default look-back for the very first poll (no watermark yet). Matches the API's own empty-window
  # behavior (past 24h) but sent explicitly so the window is deterministic and logged.
  DEFAULT_LOOKBACK = 24.hours

  def self.perform
    new.run
  end

  def run
    unless enabled?
      Rails.logger.info('[ResolveScreeningHolds] skipped: ENABLE_DESCARTES_SCREENING is off')
      return
    end

    unless client.configured?
      Rails.logger.info('[ResolveScreeningHolds] skipped: Descartes RPS resolution endpoint not configured')
      return
    end

    time_from = poll_from
    time_to = Time.now.utc

    verdicts = client.poll(time_from: time_from, time_to: time_to)
    processed = verdicts.sum { |verdict| process_verdict(verdict) }

    # Advance the watermark ONLY after the whole reply is processed without raising (fail-closed).
    advance_cursor(time_to)
    Rails.logger.info(
      "[ResolveScreeningHolds] window #{fmt(time_from)}..#{fmt(time_to)} " \
      "verdicts=#{verdicts.size} applied=#{processed}"
    )
  rescue StandardError => e
    # Do NOT advance the cursor -- the same window is re-polled next run. Never release on error.
    LogUtil.log_error('[ResolveScreeningHolds] poll failed; holds left in force, watermark not advanced',
                      exception: e)
    raise e
  end

  # Map an IM status to :release / :deny / :keep_held (public so the mapping is unit-testable). Unknown
  # statuses fall through to :keep_held (fail-closed).
  def self.disposition_for(status)
    return :release if RELEASE_STATUSES.include?(status)
    return :deny if DENY_STATUSES.include?(status)

    :keep_held
  end

  private

  def enabled?
    AppConfigHelper.get_app_config(AppConfig::ENABLE_DESCARTES_SCREENING) == '1'
  end

  def client
    @client ||= ExportControl::Descartes::ResolutionClient.new
  end

  # Process one verdict against the matching screening_results + holds. Returns 1 if it mapped to a
  # known screening row (applied), else 0. Idempotent.
  def process_verdict(verdict)
    results = correlate(verdict)
    return 0 if results.empty?

    disposition = self.class.disposition_for(verdict.shstatus)
    results.each { |screening_result| apply(screening_result, verdict, disposition) }
    1
  end

  # Correlate a verdict to its screening_results row(s). Primary key is sdistributedid == SHresult id
  # (the shared audit-record id). Secondary is soptionalid == SHoptid, but only when SHoptid is a real
  # table-keyed reference -- "0" is a permitted-but-ambiguous Compliance Manager value we never match on.
  def correlate(verdict)
    if verdict.shresult_id.present?
      by_dist = ScreeningResult.where(sdistributedid: verdict.shresult_id)
      return by_dist.to_a if by_dist.exists?
    end

    optid = verdict.shoptid
    return [] if optid.blank? || optid == '0'

    ScreeningResult.where(soptionalid: optid).to_a
  end

  def apply(screening_result, verdict, disposition)
    record_incident(screening_result, verdict)
    holds = Hold.for_subject(screening_result.subject_ref).active
                .where(screening_result_id: screening_result.id)

    case disposition
    when :release
      holds.each { |hold| hold.release!(resolution_status: verdict.shstatus, incident_id: verdict.shresult_id) }
      Rails.logger.info(
        "[ResolveScreeningHolds] RELEASE subject=#{screening_result.subject_ref} " \
        "status=#{verdict.shstatus} incident=#{verdict.shresult_id}"
      )
    when :deny
      # Terminal deny -- keep the hold in force and record the adjudication durably on
      # the hold (reviewed-and-denied), not just in the log. No release, ever.
      holds.each { |hold| hold.deny!(resolution_status: verdict.shstatus, incident_id: verdict.shresult_id) }
      Rails.logger.warn(
        "[ResolveScreeningHolds] TRUE HIT kept-held subject=#{screening_result.subject_ref} " \
        "incident=#{verdict.shresult_id}"
      )
    else
      # Non-terminal (DS New / Actioned / Escalated / Closed / unknown) -- leave held, no-op.
      Rails.logger.info(
        "[ResolveScreeningHolds] keep-held subject=#{screening_result.subject_ref} " \
        "status=#{verdict.shstatus} incident=#{verdict.shresult_id}"
      )
    end
  end

  # Stamp the IM audit-record id on the screen (evidence). Idempotent: written only when absent so a
  # re-poll of the same verdict does not churn the row.
  def record_incident(screening_result, verdict)
    return if verdict.shresult_id.blank? || screening_result.incident_id.present?

    # Deliberate single-column audit stamp: no callbacks/validations wanted, and it
    # must not churn updated_at on an idempotent re-poll of the same verdict.
    screening_result.update_column(:incident_id, verdict.shresult_id) # rubocop:disable Rails/SkipsModelValidations
  end

  # The "From" bound: the persisted watermark, or DEFAULT_LOOKBACK ago on the first ever poll. The cursor
  # is stored as an offset-less UTC ISO-8601 string (the API's format), so it MUST be parsed as UTC --
  # a naive Time.parse would misread it as local time and shift the window.
  def poll_from
    cursor = AppConfigHelper.get_app_config(AppConfig::DESCARTES_RESOLUTION_POLL_CURSOR)
    return DEFAULT_LOOKBACK.ago.utc if cursor.blank?

    Time.use_zone('UTC') { Time.zone.parse(cursor) }&.utc || DEFAULT_LOOKBACK.ago.utc
  rescue ArgumentError
    DEFAULT_LOOKBACK.ago.utc
  end

  def advance_cursor(time_to)
    AppConfigHelper.set_app_config(AppConfig::DESCARTES_RESOLUTION_POLL_CURSOR, fmt(time_to))
  end

  def fmt(time)
    ExportControl::Descartes::ResolutionClient.format_time(time)
  end
end

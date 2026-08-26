# frozen_string_literal: true

# CZID-596 (Export-control Layer 3 / #285) -- the Descartes restricted-party SCREENING orchestrator. It
# wraps the SearchEntity REST/JSON client, persists a screening_results row, and (on a hold) creates a
# holds row. It is the "clean screen(subject) -> outcome" core; the provider-contract adapter
# (ExportControl::Providers::Descartes) delegates here.
#
# ============================ OFF-BY-DEFAULT / FULL BYPASS ============================
# This whole service is gated by AppConfig::ENABLE_DESCARTES_SCREENING, which defaults OFF. When it is
# off, screen_if_enabled RETURNS nil IMMEDIATELY: no client is built, NO network call is made, NO
# screening_results/holds row is written. That is a full BYPASS -- NOT "enabled but denying". Callers at
# a (future, counsel-gated -- CZID-599) gate point MUST use screen_if_enabled so the flag-off path is
# indistinguishable from the feature not existing. There is intentionally NO live caller of this service
# in the app yet; the core ships dark.
#
# ============================ POLICY (SMP-1684) ============================
# ScreeningPolicy is now WIRED IN (it previously had zero live callers). Before any vendor call, screen():
#   - WHITELIST: a counsel-cleared subject (by ref or email domain) is ALLOWED with no vendor call and no
#     screening_results row.
#   - SCREEN-ONCE CADENCE: if the subject has a recent PASSING screen still within the re-screen cadence
#     AND no active hold, screen() skips the vendor call (no per-request screening / no unbounded row
#     growth / no per-request metered transaction -- the bug this ticket fixes).
#   - HIT-HANDLING: on a hit the policy (block/hold/report) is recorded; a "report" hit emits a report
#     audit signal. It NEVER downgrades a hit to an allow.
#   - RPS GROUPS / endpoint / creds flow through ScreeningPolicy.client_config.
#
# ============================ ERROR-HOLD RELEASE (SMP-1692) ============================
# A fail-closed ERROR hold (screening_result_id NULL) cannot be adjudicated by the Incident-Manager
# poller -- there is no incident. It is released by RE-SCREEN: when a subsequent screen for the subject
# comes back CLEAN (or the subject is whitelisted), screen() releases that subject's active error holds
# (the transient vendor failure has resolved). An operator backstop exists for stuck holds:
# `rake export_control:release_error_holds[<subject_ref>]` (lib/tasks/export_control_holds.rake).
#
# ============================ FAIL-CLOSED (only when ON) ============================
# When the flag IS on and screen(subject) runs, the decision is transstatus-primary and fail-closed:
#   - transstatus == "Passed"           -> ALLOWED (screening_results row, no hold)
#   - transstatus == "On Hold-RPS"      -> HELD    (screening_results row + hold)
#   - per-search error / transport / timeout / config-missing / anything unknown -> HELD (error hold,
#     no screening_results row -- there is no valid alert level to record)
# Never releases on uncertainty.
module ExportControl
  class ScreeningService
    PROVIDER = 'descartes'

    # The party to screen. subject_ref is OUR opaque handle (e.g. "User:42"); soptionalid is the
    # TABLE-KEYED correlation id we send to Descartes -- the caller mints it from the subject's DB id
    # (Compliance Manager requires "0" or a table-keyed reference, never a random GUID). Blank => "0".
    # email is OPTIONAL (nil-safe) and used ONLY for the whitelist domain match -- it is NEVER sent to the
    # vendor and NEVER logged.
    Subject = Struct.new(
      :subject_ref, :subject_type, :name, :company,
      :address1, :city, :state, :zip, :country, :soptionalid, :email,
      keyword_init: true
    )

    # decision is :allowed / :held / :error. screening_result/hold are the persisted rows (either may be
    # nil). to_provider_result maps onto the provider-agnostic DeniedPartyScreeningProvider contract.
    Outcome = Struct.new(:decision, :screening_result, :hold, keyword_init: true) do
      def allowed?
        decision == :allowed
      end

      def to_provider_result
        result = case decision
                 when :allowed then ExportControlClearance::SCREENING_CLEAR
                 when :held    then ExportControlClearance::SCREENING_HIT
                 else ExportControlClearance::SCREENING_PENDING # :error -> uncertain -> deny
                 end
        ExportControl::DeniedPartyScreeningProvider::Result.new(
          result: result, provider: PROVIDER, evidence_ref: screening_result&.sdistributedid
        )
      end
    end

    def initialize(client: nil)
      @client = client
    end

    # True only when the operator has explicitly enabled Descartes screening. Off by default = ship dark.
    def enabled?
      AppConfigHelper.get_app_config(AppConfig::ENABLE_DESCARTES_SCREENING) == '1'
    end

    # The flag-gated entry point. Returns nil (FULL BYPASS -- no call, no rows) when disabled. This is the
    # only method a caller should use so the off path is a true no-op.
    def screen_if_enabled(subject)
      return nil unless enabled?

      screen(subject)
    end

    # Screen a subject. Assumes the caller has already confirmed enabled? (screen_if_enabled does).
    # Fail-closed: any error path produces a HELD outcome, never an allow.
    def screen(subject)
      # SMP-1684: a counsel-cleared (whitelisted) subject is allowed with NO vendor call and NO row.
      # A clear subject also has any stale fail-closed error hold released (SMP-1692).
      if ExportControl::ScreeningPolicy.whitelisted?(subject.subject_ref, subject.email)
        release_error_holds(subject, resolution_status: 'whitelisted')
        audit('screen.whitelisted', subject, decision: 'allowed')
        return Outcome.new(decision: :allowed, screening_result: nil, hold: nil)
      end

      # SMP-1684: screen-once -- a recent passing screen within cadence (and no active hold) means we do
      # NOT re-screen on this request. This is the fix for "unconditional vendor call + row per request".
      if within_rescreen_cadence?(subject.subject_ref)
        audit('screen.cadence_skip', subject, decision: 'allowed')
        return Outcome.new(decision: :allowed, screening_result: nil, hold: nil)
      end

      soptionalid = subject.soptionalid.presence || '0' # table-keyed or "0", never random
      begin
        response = client.search(subject, soptionalid: soptionalid)
      rescue StandardError => e
        # SMP-1693: log the error CLASS only -- an exception message from the client/transport can carry
        # the screened party's name (vendor body interpolation), which must never reach a log line.
        Rails.logger.error("[ScreeningService] fail-closed HOLD for #{subject.subject_ref}: #{e.class}")
        return hold_on_error(subject)
      end

      return hold_on_error(subject) if response.errored?

      # SMP-1695 (gap C-129): persistence itself can fail (Aurora failover, pool exhaustion, a
      # validation error). Without this rescue the request 500s leaving NO hold, NO screening_results
      # row, and NO audit record -- the screen leaves no compliance evidence. Fail closed WITH evidence.
      begin
        persist_and_decide(subject, soptionalid, response)
      rescue StandardError => e
        persist_error_outcome(subject, e)
      end
    end

    private

    def client
      # SMP-1684: build the client from ScreeningPolicy (endpoint + creds + rps_groups), not bare env, so
      # counsel's group scope is actually applied. Injected client (tests) still wins.
      @client ||= ExportControl::Descartes::SearchEntityClient.new(config: ExportControl::ScreeningPolicy.client_config)
    end

    def persist_and_decide(subject, soptionalid, response)
      # SMP-1253: stamp the OTel trace id onto the durable evidence row so each compliance
      # record cross-links to its distributed trace. nil when tracing is off (local/test/CI).
      trace_id = ExportControl::ScreeningAudit.current_trace_id
      # Zero-tolerance geo rule (counsel): an association with a sanctioned jurisdiction is a hard HOLD
      # regardless of name-match or transstatus. Two independent sources: our in-house embargo list
      # (subject.country) and the vendor's own risk_country flag. Stamped onto the row so the decision
      # is durable evidence even if the embargo list later changes.
      jurisdiction_risk =
        ExportControl::ScreeningPolicy.sanctioned_country?(subject.country) ||
        response.risk_country.to_i >= 1
      screening_result = ScreeningResult.create!(
        subject_ref: subject.subject_ref,
        subject_type: subject.subject_type,
        soptionalid: soptionalid,
        transstatus: response.transstatus,
        alert_level: response.alert_level,
        risk_country: response.risk_country,
        country: subject.country,
        jurisdiction_risk: jurisdiction_risk,
        list: response.list || configured_list_label,
        sdistributedid: response.sdistributedid,
        incident_id: nil, # populated later by the CZID-598 resolution poller
        provider: PROVIDER,
        screened_at: Time.current,
        raw_response_ref: response.raw_ref,
        trace_id: trace_id
      )

      # Jurisdiction rule takes precedence over the transstatus/name-match path: a sanctioned-jurisdiction
      # association HOLDs (RED) even if the name screen returned "Passed"/nomatch.
      if jurisdiction_risk
        hold = create_hold(subject, Hold::REASON_SANCTIONED_JURISDICTION, screening_result)
        ExportControl::ScreeningAudit.record(
          "screen.held",
          subject_ref: subject.subject_ref, decision: "held",
          alert_level: screening_result.effective_alert_level, reason: Hold::REASON_SANCTIONED_JURISDICTION,
          screening_result_id: screening_result.id, hold_id: hold.id,
          provider: PROVIDER, trace_id: trace_id
        )
        return Outcome.new(decision: :held, screening_result: screening_result, hold: hold)
      end

      if screening_result.hold_required?
        # SMP-1684: record counsel's hit-handling policy; never downgrade a hit to an allow.
        policy = ExportControl::ScreeningPolicy.hit_handling
        hold = create_hold(subject, Hold::REASON_SCREENING_HIT, screening_result)
        # SMP-1253 audit: identifiers only -- never the screened party's name/address.
        ExportControl::ScreeningAudit.record(
          "screen.held",
          subject_ref: subject.subject_ref, decision: "held", alert_level: screening_result.alert_level,
          screening_result_id: screening_result.id, hold_id: hold.id, hit_handling: policy,
          provider: PROVIDER, trace_id: trace_id
        )
        if policy == ExportControl::ScreeningPolicy::HIT_REPORT
          ExportControl::ScreeningAudit.record(
            "screen.hit_reported",
            subject_ref: subject.subject_ref, decision: "held", hold_id: hold.id,
            provider: PROVIDER, trace_id: trace_id
          )
        end
        Outcome.new(decision: :held, screening_result: screening_result, hold: hold)
      else
        # SMP-1692: a clean screen clears any stale fail-closed error hold for this subject.
        release_error_holds(subject, resolution_status: 're-screen-cleared')
        ExportControl::ScreeningAudit.record(
          "screen.allowed",
          subject_ref: subject.subject_ref, decision: "allowed", alert_level: screening_result.alert_level,
          screening_result_id: screening_result.id, provider: PROVIDER, trace_id: trace_id
        )
        Outcome.new(decision: :allowed, screening_result: screening_result, hold: nil)
      end
    end

    # SMP-1695 (gap C-129): a persist_and_decide failure still leaves DURABLE EVIDENCE and fails closed.
    # ScreeningAudit.record is log-based and inert-safe (it never raises and does not touch the DB), so
    # the audit line survives even when the DB is the thing that just failed. We deliberately do NOT
    # retry a DB write here (that is exactly what failed) and we NEVER downgrade to an allow: the
    # :error decision maps to SCREENING_PENDING -> deny, identical to the other fail-closed paths.
    def persist_error_outcome(subject, error)
      Rails.logger.error(
        "[ScreeningService] fail-closed (persist error) for #{subject.subject_ref}: #{error.class}"
      )
      ExportControl::ScreeningAudit.record(
        "screen.persist_error",
        subject_ref: subject.subject_ref, decision: "error", reason: Hold::REASON_SCREENING_ERROR,
        error_class: error.class.name, provider: PROVIDER,
        trace_id: ExportControl::ScreeningAudit.current_trace_id
      )
      Outcome.new(decision: :error, screening_result: nil, hold: nil)
    end

    # Fail-closed hold with no screening row (transport/timeout/config/per-search error).
    def hold_on_error(subject)
      hold = create_hold(subject, Hold::REASON_SCREENING_ERROR, nil)
      ExportControl::ScreeningAudit.record(
        "screen.error",
        subject_ref: subject.subject_ref, decision: "error", reason: Hold::REASON_SCREENING_ERROR,
        hold_id: hold.id, provider: PROVIDER, trace_id: ExportControl::ScreeningAudit.current_trace_id
      )
      Outcome.new(decision: :error, screening_result: nil, hold: hold)
    end

    def create_hold(subject, reason, screening_result)
      Hold.create!(
        subject_ref: subject.subject_ref,
        subject_type: subject.subject_type,
        reason: reason,
        screening_result_id: screening_result&.id,
        # SMP-1253: cross-link the hold to its distributed trace (nil when tracing is off).
        trace_id: ExportControl::ScreeningAudit.current_trace_id
      )
    end

    # SMP-1684: the subject may skip a fresh screen when a recent PASSING screen is still within the
    # re-screen cadence AND there is no active hold. A subject with ANY active hold is never skipped --
    # a held (hit OR fail-closed error) subject must not be waved through by cadence.
    def within_rescreen_cadence?(subject_ref)
      return false if Hold.for_subject(subject_ref).active.exists?

      last_pass = ScreeningResult.for_subject(subject_ref)
                                 .where(transstatus: ScreeningResult::TRANSSTATUS_PASSED)
                                 .latest_first.first
      return false if last_pass.nil?

      !ExportControl::ScreeningPolicy.rescreen_due?(last_pass.screened_at)
    end

    # SMP-1692: release a subject's active fail-closed ERROR holds (reason screening_error). Called when
    # the subject is re-screened clean or whitelisted -- the transient vendor failure has resolved. Uses
    # Hold#release! (previously reachable only from the poller, which can never match an error hold).
    # Inert-safe: a release failure never breaks the screen path.
    def release_error_holds(subject, resolution_status:)
      holds = Hold.for_subject(subject.subject_ref).active.where(reason: Hold::REASON_SCREENING_ERROR).to_a
      return if holds.empty?

      holds.each { |hold| hold.release!(resolution_status: resolution_status) }
      ExportControl::ScreeningAudit.record(
        "screen.error_hold_released",
        subject_ref: subject.subject_ref, decision: "error_hold_released", count: holds.size,
        resolution_status: resolution_status, provider: PROVIDER,
        trace_id: ExportControl::ScreeningAudit.current_trace_id
      )
    rescue StandardError => e
      Rails.logger.error("[ScreeningService] error-hold release failed for #{subject.subject_ref}: #{e.class}")
    end

    # Identifiers-only audit helper for the no-vendor-call outcomes (whitelist / cadence skip). NEVER PII.
    def audit(event, subject, decision:)
      ExportControl::ScreeningAudit.record(
        event, subject_ref: subject.subject_ref, decision: decision, provider: PROVIDER,
        trace_id: ExportControl::ScreeningAudit.current_trace_id
      )
    end

    def configured_list_label
      ENV['DESCARTES_RPS_LIST_LABEL'].presence
    end
  end
end

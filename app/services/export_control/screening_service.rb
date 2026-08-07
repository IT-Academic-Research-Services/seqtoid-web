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
    Subject = Struct.new(
      :subject_ref, :subject_type, :name, :company,
      :address1, :city, :state, :zip, :country, :soptionalid,
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
      @client ||= ExportControl::Descartes::SearchEntityClient.new
    end

    def persist_and_decide(subject, soptionalid, response)
      # SMP-1253: stamp the OTel trace id onto the durable evidence row so each compliance
      # record cross-links to its distributed trace. nil when tracing is off (local/test/CI).
      trace_id = ExportControl::ScreeningAudit.current_trace_id
      screening_result = ScreeningResult.create!(
        subject_ref: subject.subject_ref,
        subject_type: subject.subject_type,
        soptionalid: soptionalid,
        transstatus: response.transstatus,
        alert_level: response.alert_level,
        risk_country: response.risk_country,
        list: response.list || configured_list_label,
        sdistributedid: response.sdistributedid,
        incident_id: nil, # populated later by the CZID-598 resolution poller
        provider: PROVIDER,
        screened_at: Time.current,
        raw_response_ref: response.raw_ref,
        trace_id: trace_id
      )

      if screening_result.hold_required?
        hold = create_hold(subject, Hold::REASON_SCREENING_HIT, screening_result)
        # SMP-1253 audit: identifiers only -- never the screened party's name/address.
        ExportControl::ScreeningAudit.record(
          "screen.held",
          subject_ref: subject.subject_ref, decision: "held", alert_level: screening_result.alert_level,
          screening_result_id: screening_result.id, hold_id: hold.id, provider: PROVIDER, trace_id: trace_id
        )
        Outcome.new(decision: :held, screening_result: screening_result, hold: hold)
      else
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

    def configured_list_label
      ENV['DESCARTES_RPS_LIST_LABEL'].presence
    end
  end
end

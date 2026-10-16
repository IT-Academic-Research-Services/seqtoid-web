# frozen_string_literal: true

# Option A service-side worker (runs on the screening-role pods). Consumes an applicant enqueued by
# Internal::ScreeningsController, runs the REAL in-process screen (Descartes) exactly as the old
# in-web-app path did, and posts the decision back to the web app via a signed callback.
#
# ============================ VISUAL COMPLIANCE DECIDES ============================
# This job never makes a screening decision of its own. outcome.allowed? is true only when Descartes
# returned a clean verdict (ScreeningService relays it, fail-closed); then we post an "approved" callback
# carrying the account payload to seed. Anything else -- a Descartes match, or a fail-closed error --
# holds the applicant (PendingSignup) and posts nothing. The approve/deny callback is sent later by the
# resolution poller, driven by the compliance officer's verdict in the Descartes Incident Manager.
# There is no auto-deny: every denial is an officer's True Hit. A disabled/bypassed screen (nil) is a
# no-op.
class ProcessScreeningJob
  extend InstrumentedJob

  @queue = :process_screening

  def self.enqueue(payload)
    Resque.enqueue(self, payload)
  end

  def self.perform(payload)
    new.run(payload)
  end

  def run(payload)
    outcome = ExportControl::ScreeningService.new.screen_if_enabled(subject_from(payload))
    if outcome&.allowed?
      post_callback(payload, decision: 'approved', path: 'auto', account: payload['account'])
    elsif outcome
      # A Descartes match or a fail-closed error. HOLD the applicant account data (piece 5b) so the
      # resolution poller can drive the approved/denied callback once a compliance officer adjudicates the
      # case in the Descartes Incident Manager. A screen with no account payload (a non-signup screen) holds
      # nothing to provision, so skip persisting one.
      hold_pending_signup(payload) if payload['account'].present?
      Rails.logger.info(
        "[ProcessScreeningJob] #{payload['correlation_id']} not auto-approved " \
        "(decision=#{outcome.decision.inspect}) -- held for manual resolution"
      )
    else
      # Disabled / bypass (flag off): the screen is a full no-op; there is nothing to hold or resolve.
      Rails.logger.info("[ProcessScreeningJob] #{payload['correlation_id']} screening disabled -- no-op")
    end
  rescue StandardError => e
    # Fail-closed: never post an approval on error. The applicant stays unscreened/held.
    Rails.logger.error("[ProcessScreeningJob] #{payload['correlation_id']} error: #{e.class}")
    # ...but ALERT. Swallowing the exception is correct here (a re-raise would re-bill the vendor on a
    # Resque retry); swallowing the signal is not -- this rescue is the outermost one on the screen path,
    # so anything it eats means an applicant silently never got screened.
    ExportControl::ScreeningAudit.report_failure(
      "screen.job_error", error: e, correlation_id: payload["correlation_id"], screening_id: payload["screening_id"]
    )
  end

  private

  # Durably hold the applicant's account data so the resolution poller can approve/deny it later. Its own
  # rescue: a persistence failure must not re-raise into the screen path (that would re-bill the vendor on
  # a Resque retry). The hold itself is already recorded by ScreeningService; the officer sees it in
  # Descartes regardless, so the worst case is losing the auto-provision-on-release convenience.
  def hold_pending_signup(payload)
    PendingSignup.hold!(
      subject_ref: payload['correlation_id'],
      screening_id: payload['screening_id'],
      callback_url: payload['callback_url'],
      account: payload['account']
    )
  rescue StandardError => e
    Rails.logger.error("[ProcessScreeningJob] #{payload['correlation_id']} pending-signup hold failed: #{e.class}")
    # This is the failure that stranded a real applicant in env-prod on 2026-09-23: the hold row could not
    # be written (ActiveRecord::Encryption::Errors::Configuration on a misrouted web pod), so once a
    # compliance officer released the hold there was nothing left to provision from and the account could
    # never be created. The applicant just sat on "under review" forever. It must never be silent again.
    ExportControl::ScreeningAudit.report_failure(
      "signup.hold_lost", error: e, correlation_id: payload["correlation_id"], screening_id: payload["screening_id"]
    )
  end

  def subject_from(payload)
    subject = payload['subject'] || {}
    ExportControl::ScreeningService::Subject.new(
      subject_ref: payload['correlation_id'],
      subject_type: 'User',
      name: subject['name'],
      company: subject['company'],
      address1: subject['address1'],
      city: subject['city'],
      state: subject['state'],
      zip: subject['zip'],
      country: subject['country'],
      soptionalid: payload['soptionalid']
    )
  end

  def post_callback(payload, decision:, path:, account: nil)
    url = payload['callback_url'].presence
    return if url.blank?

    body = JSON.dump(
      {
        screening_id: payload['screening_id'],
        correlation_id: payload['correlation_id'],
        decision: decision,
        path: path,
        account: account,
      }.compact
    )
    ExportControl::ScreeningServiceClient.post_signed(url, body)
  end
end

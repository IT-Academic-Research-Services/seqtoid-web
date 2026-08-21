# frozen_string_literal: true

# Option A service-side worker (runs on the screening-role pods). Consumes an applicant enqueued by
# Internal::ScreeningsController, runs the REAL in-process screen (Descartes) exactly as the old
# in-web-app path did, and posts the decision back to the web app via a signed callback.
#
# ============================ AUTO-APPROVE ONLY ON A SOLID PASS ============================
# outcome.allowed? is true only for a clean, definitive pass (transstatus "Passed", no denied-party
# match, no sanctioned-jurisdiction hit) -- ScreeningService already encodes that fail-closed. Only then
# do we post an "approved" callback (carrying the account payload to seed). A HELD or ERROR outcome, or a
# disabled/bypassed screen (nil), posts NO approval: the account is not created, and the resolution
# poller sends the eventual approve/deny callback after a human adjudicates. That persistence + the
# poller->callback hook is the next piece (it lands with the dedicated screening DB).
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
    elsif sanctioned_jurisdiction?(outcome)
      # Zero-tolerance geo rule (CZID-321): an association with a SANCTIONED JURISDICTION (the applicant's
      # declared country is on the embargo list, or the vendor flagged risk_country) is an UNAMBIGUOUS,
      # hard denial -- the same list the edge WAF geo-block enforces. Auto-DENY immediately (no 48h manual
      # queue, no held signup to resolve): a party who must not be admitted is denied at once.
      post_callback(payload, decision: 'denied', path: 'auto', account: nil)
      Rails.logger.warn("[ProcessScreeningJob] #{payload['correlation_id']} auto-denied: sanctioned jurisdiction")
    elsif outcome
      # A NAME-MATCH hit or a fail-closed error -- genuine ambiguity that needs a human. HOLD the applicant
      # account data (piece 5b) so the resolution poller can drive the approved/denied callback once a
      # compliance officer adjudicates. A screen with no account payload (a non-signup screen) holds
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
  end

  private

  # A hold placed specifically for a sanctioned-jurisdiction association (vs a name-match hit or a
  # fail-closed error). Only this reason auto-denies; everything else routes to manual review.
  def sanctioned_jurisdiction?(outcome)
    outcome&.hold&.reason == Hold::REASON_SANCTIONED_JURISDICTION
  end

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
        account: account
      }.compact
    )
    ExportControl::ScreeningServiceClient.post_signed(url, body)
  end
end

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
    else
      # Held / error / disabled: no auto-approval. Nothing to seed now; the poller resolves it later.
      Rails.logger.info(
        "[ProcessScreeningJob] #{payload['correlation_id']} not auto-approved " \
        "(decision=#{outcome&.decision.inspect}) -- awaiting manual resolution"
      )
    end
  rescue StandardError => e
    # Fail-closed: never post an approval on error. The applicant stays unscreened/held.
    Rails.logger.error("[ProcessScreeningJob] #{payload['correlation_id']} error: #{e.class}")
  end

  private

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

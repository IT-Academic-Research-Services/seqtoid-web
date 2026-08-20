# frozen_string_literal: true

module Internal
  # Option A service-side ingest. The web-role pods POST an applicant here (via the in-cluster screening
  # Service); this endpoint HMAC-authenticates, enqueues the async screen, and returns 202. In practice
  # only the screening-role pods do the real work (the web pods carry no DESCARTES creds), but the auth +
  # the internal-only route keep it safe regardless.
  #
  # Subclasses ActionController::Base (NOT ApplicationController) on purpose: none of the user-auth /
  # export-control / attestation before_actions apply -- this is a headless service-to-service endpoint,
  # authenticated by a shared HMAC signature, not a user session (same discipline as ChaosController).
  #
  # FAIL CLOSED: if SCREENING_SERVICE_SIGNING_SECRET is unset the endpoint is DISABLED (503). It never
  # ships open.
  class ScreeningsController < ActionController::Base # rubocop:disable Rails/ApplicationController
    def create
      return head(:service_unavailable) if signing_secret.blank?
      return head(:unauthorized) unless valid_signature?

      payload = JSON.parse(request.raw_post)
      screening_id = SecureRandom.uuid
      ProcessScreeningJob.enqueue(payload.merge('screening_id' => screening_id))
      render json: { screening_id: screening_id, status: 'pending' }, status: :accepted
    rescue JSON::ParserError
      head :bad_request
    end

    private

    def signing_secret
      ENV['SCREENING_SERVICE_SIGNING_SECRET'].presence
    end

    def valid_signature?
      provided = request.headers['X-Export-Control-Signature'].to_s
      return false if provided.blank?

      expected = OpenSSL::HMAC.hexdigest('SHA256', signing_secret, request.raw_post)
      ActiveSupport::SecurityUtils.secure_compare(provided, expected)
    rescue StandardError => e
      Rails.logger.error("[Internal::Screenings] signature check error: #{e.class}")
      false
    end
  end
end

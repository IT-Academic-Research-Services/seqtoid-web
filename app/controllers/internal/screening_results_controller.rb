# frozen_string_literal: true

module Internal
  # Option A callback RECEIVER (runs on the web-role pods -- they own Auth0 + the app DB). The screening
  # service posts its decision here (signed with the shared secret). We enqueue the account work and 200
  # immediately, so provisioning (a slow Auth0 call) never blocks the callback.
  #
  # Subclasses ActionController::Base (NOT ApplicationController): headless service-to-service, HMAC-authed
  # rather than a user session. FAIL CLOSED: disabled (503) if the signing secret is unset.
  class ScreeningResultsController < ActionController::Base # rubocop:disable Rails/ApplicationController
    def create
      return head(:service_unavailable) if signing_secret.blank?
      return head(:unauthorized) unless valid_signature?

      payload = JSON.parse(request.raw_post)
      ProvisionScreenedAccountJob.enqueue(payload)
      head :ok
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
      Rails.logger.error("[Internal::ScreeningResults] signature check error: #{e.class}")
      false
    end
  end
end

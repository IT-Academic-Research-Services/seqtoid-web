# frozen_string_literal: true

require 'uri'
require 'net/http'
require 'openssl'
require 'json'

# Option A boundary (screening as a standalone deployment): the client the WEB APP uses to hand an
# applicant to the standalone screening service over HTTP, instead of calling Descartes in-process.
#
# INERT UNTIL CONFIGURED: with SCREENING_SERVICE_URL/-SIGNING_SECRET unset, configured? is false and no
# call can be built -- the web app keeps using whichever DeniedPartyScreeningProvider is selected. The
# same seqtoid-web image runs the screening service (with EXPORT_CONTROL_SCREENING_PROVIDER=descartes),
# so this client is only exercised by the web-role pods, which point at the screening Service DNS.
#
# The call is fire-and-forget from the web app's side (the provider returns PENDING immediately and the
# decision arrives via the signed callback), with BOUNDED timeouts + the shared circuit breaker so a
# slow/down screening service can never wedge a web request thread.
module ExportControl
  module ScreeningServiceClient
    class Error < StandardError; end
    class ConfigurationError < Error; end

    OPEN_TIMEOUT = 3
    READ_TIMEOUT = 5
    SCREENINGS_PATH = '/internal/v1/screenings'

    module_function

    # Base URL of the screening service (its in-cluster Service DNS), e.g. http://seqtoid-env-prod-screening.
    def base_url
      ENV['SCREENING_SERVICE_URL'].presence
    end

    # Shared secret used to HMAC-sign the submit body (the service verifies it). Same scheme as the
    # export-control clearance callback (X-Export-Control-Signature).
    def signing_secret
      ENV['SCREENING_SERVICE_SIGNING_SECRET'].presence
    end

    # Where the service POSTs its decision back to. The web app exposes this; the service calls it.
    def callback_url
      ENV['SCREENING_SERVICE_CALLBACK_URL'].presence
    end

    def configured?
      base_url.present? && signing_secret.present?
    end

    def screenings_url
      return nil if base_url.blank?

      URI.join(base_url, SCREENINGS_PATH).to_s
    end

    def sign(body)
      OpenSSL::HMAC.hexdigest('SHA256', signing_secret.to_s, body.to_s)
    end

    # POST a signed JSON body. Wrapped in the shared breaker + bounded timeouts. Raises on transport
    # failure -- callers (the provider) rescue to PENDING so a screening-service outage never leaks.
    def post_signed(url, body)
      uri = URI(url)
      req = Net::HTTP::Post.new(uri)
      req['Content-Type'] = 'application/json'
      req['X-Export-Control-Signature'] = sign(body)
      req.body = body
      HttpResilience.breaker(:screening_service).run do
        HttpResilience.request(req, uri, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT)
      end
    end
  end
end

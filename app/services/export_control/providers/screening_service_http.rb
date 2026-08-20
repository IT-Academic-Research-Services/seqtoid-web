# frozen_string_literal: true

# Option A boundary: when EXPORT_CONTROL_SCREENING_PROVIDER = "screening_service", the web app delegates
# screening to the standalone service. This provider POSTs the applicant to the service ASYNCHRONOUSLY
# and returns PENDING at once -- the web app never calls Descartes and never blocks on it. The real
# decision (approved / denied) arrives later via the service's signed callback, which drives account
# provisioning / the applicant's clearance record.
#
# FAIL-CLOSED: an unconfigured client or any transport error also returns PENDING (uncertainty == deny),
# never a clear -- identical to how Providers::Descartes fails closed when disabled.
module ExportControl
  module Providers
    module ScreeningServiceHttp
      module_function

      def screen(user, ctx = {})
        submit(user, ctx) if ExportControl::ScreeningServiceClient.configured?
        pending_result
      rescue StandardError => e
        # Never raise into the caller. PENDING = deny/hold; the callback is the source of truth. Log the
        # class only -- an HTTP error message can echo request-body fragments (the applicant's name).
        Rails.logger.error("[ScreeningServiceHttp] submit failed for User:#{user&.id}: #{e.class}")
        pending_result
      end

      # The screening subject + the account payload the service holds and returns on approval. Country is
      # the generic viewer geo (never a precise/home address beyond what the applicant supplied).
      def submit(user, ctx)
        body = JSON.dump(
          correlation_id: "User:#{user&.id}",
          subject: {
            name: user&.name,
            company: ctx[:company],
            address1: ctx[:address1],
            city: ctx[:city],
            state: ctx[:state],
            zip: ctx[:zip],
            country: ctx[:country].presence || ctx[:viewer_country]
          },
          account: {
            email: user&.email,
            name: user&.name,
            institution: ctx[:institution]
          },
          soptionalid: user&.id&.to_s,
          callback_url: ExportControl::ScreeningServiceClient.callback_url
        )
        ExportControl::ScreeningServiceClient.post_signed(
          ExportControl::ScreeningServiceClient.screenings_url, body
        )
      end

      def pending_result
        ExportControl::DeniedPartyScreeningProvider::Result.new(
          result: ExportControlClearance::SCREENING_PENDING,
          provider: 'screening_service',
          evidence_ref: nil
        )
      end
    end
  end
end

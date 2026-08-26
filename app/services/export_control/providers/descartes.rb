# frozen_string_literal: true

# CZID-596 (Export-control Layer 3 / #285) -- the Descartes implementation of the provider-agnostic
# DeniedPartyScreeningProvider contract (screen(user, ctx) -> Result). This is the module that
# ExportControl::DeniedPartyScreeningProvider.provider_module resolves to WHEN, and only when, the
# operator has BOTH selected "descartes" as the committed PROVIDER (default is "reference_stub") AND
# enabled Descartes screening. It maps a user onto a ScreeningService::Subject, delegates to the
# ScreeningService, and returns the lightweight contract Result.
#
# DOUBLE-SAFE / DARK: the default PROVIDER is "reference_stub", so this module is never reached on the
# default path. On top of that, ScreeningService is OFF by default -- if screening is disabled this
# returns PENDING (deny, fail-closed) WITHOUT any network call. There is no allow-on-uncertainty path.
module ExportControl
  module Providers
    module Descartes
      module_function

      def screen(user, ctx = {})
        service = ExportControl::ScreeningService.new
        # When Descartes screening is disabled, do NOT call out. The provider contract still requires a
        # non-"clear" result (uncertainty == deny), so return PENDING -- no network, no rows.
        return pending_result unless service.enabled?

        outcome = service.screen(subject_for(user, ctx))
        outcome.to_provider_result
      end

      # Build the screening subject from the user. soptionalid is TABLE-KEYED to the users row (user.id),
      # per Compliance Manager's "0"-or-table-keyed rule -- never a random GUID.
      def subject_for(user, ctx)
        ExportControl::ScreeningService::Subject.new(
          subject_ref: "User:#{user&.id}",
          subject_type: 'User',
          name: user&.name,
          company: ctx[:company],
          address1: ctx[:address1],
          city: ctx[:city],
          state: ctx[:state],
          zip: ctx[:zip],
          # Generic (country-level) location so the vendor can populate risk_country for
          # high-risk-jurisdiction detection. request_evidence_ctx carries viewer_country
          # (the CloudFront-Viewer-Country header -- an ISO-3166 alpha-2 from the request
          # geo); fall back to it when no explicit country is supplied. Never a precise
          # or home address -- country granularity only.
          country: ctx[:country].presence || ctx[:viewer_country],
          soptionalid: user&.id&.to_s
        )
      end

      def pending_result
        ExportControl::DeniedPartyScreeningProvider::Result.new(
          result: ExportControlClearance::SCREENING_PENDING,
          provider: ExportControl::ScreeningService::PROVIDER,
          evidence_ref: nil
        )
      end
    end
  end
end

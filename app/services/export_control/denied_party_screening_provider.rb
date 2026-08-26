# CZID-285 — the provider-agnostic denied/restricted-party SCREENING contract (the swap point), mirroring
# the IDV adapter + the Layer-2 edge adapter. The gate + controller consume ONLY this interface.
#
# Screens the identity against denied/restricted-party lists — OFAC SDN, BIS Entity List / Denied Persons
# List, and any others counsel deems applicable. Pluggable vendors: Descartes, Refinitiv World-Check, or a
# sanctions-API — all behind this interface.
#
# TODO(counsel/vendor): the FINAL screening vendor, the applicable LISTS + their sourcing/refresh cadence,
# and the legally-correct response to a HIT are counsel-owned (design doc Layer 3; a hit is not merely a
# technical deny — it may carry reporting obligations). Engineering only records the outcome + fails closed.
#
# Contract — screen(user, ctx) returns a Result:
#   result:        one of ExportControlClearance::SCREENING_RESULTS (clear/hit/pending)
#   provider:      the provider name, for the CZID-331 evidence record
#   evidence_ref:  opaque vendor case/screen id — NOT raw list data
#
# FAIL-CLOSED: any provider error/timeout MUST surface as a raise or a non-"clear" result. A HIT and a
# PENDING both DENY. A provider must NEVER return "clear" on uncertainty.
module ExportControl
  module DeniedPartyScreeningProvider
    Result = Struct.new(:result, :provider, :evidence_ref, keyword_init: true)

    # The fail-closed default. When the AppConfig key below is unset/blank the provider resolves here
    # (reference stub -> returns PENDING -> deny), so behaviour is unchanged until an operator opts in.
    DEFAULT_PROVIDER = "reference_stub".freeze

    # TODO(counsel/vendor): once the procurement-chosen vendor's DPA + list access + keys are in place,
    # flip go-live by setting the AppConfig::EXPORT_CONTROL_SCREENING_PROVIDER row to "descartes" (no
    # code deploy; rollback is the same row). The committed default remains the reference stub
    # (returns PENDING -> deny). No value opens a permissive path -- unknown/blank fails closed.
    module_function

    def screen(user, ctx = {})
      provider_module.screen(user, ctx)
    end

    # The selected provider name, read from AppConfig at runtime so go-live (and rollback) is a config
    # row, not a deploy. Blank/unset => DEFAULT_PROVIDER (fail-closed).
    def provider_name
      AppConfigHelper.get_app_config(AppConfig::EXPORT_CONTROL_SCREENING_PROVIDER, DEFAULT_PROVIDER)
    end

    def provider_module
      case provider_name
      when "descartes"    then Providers::Descartes
      when "world_check"  then Providers::WorldCheck
      # Option A: the web-role pods delegate to the standalone screening service over HTTP (async +
      # callback), so no Descartes call ever runs in a web request. The screening-role pods run the same
      # image with provider="descartes" and do the real work.
      when "screening_service" then Providers::ScreeningServiceHttp
      # when "sanctions_api" → add the module when that vendor is chosen (TODO(vendor)).
      else
        # Any unknown/blank value (and the "reference_stub" default) FAILS CLOSED to the stub.
        Providers::ReferenceStub
      end
    end
  end
end

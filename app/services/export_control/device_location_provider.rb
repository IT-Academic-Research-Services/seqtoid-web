# CZID-286 — the provider-agnostic device / location attestation-VERIFICATION contract (server-side).
# Mirrors the IDV + screening adapters. The endpoint + gate consume ONLY this interface.
#
# The SERVER's job here is to VERIFY the attestation the client obtained from the device-location vendor's
# SDK, and map the result onto DeviceLocationAttestation::STATUSES. The vendor is selected at runtime by
# AppConfig::DEVICE_LOCATION_PROVIDER (see provider_module).
#
# CLIENT SDK: GeoComply's browser SDK is BrowserGuard (part of GeoComply Core; "PinPoint" is GeoComply's
# on-site beacon product, not this SDK). The attestation page (device_location_attestations/new) loads it,
# runs a check, and POSTs the result to DeviceLocationAttestationsController#create, which calls
# verify_token below.
#
# Contract — verify_token(token, ctx) returns a Result:
#   status:         one of DeviceLocationAttestation::STATUSES (verified/failed/pending)
#   failure_reason: a DeviceLocationAttestation::FAILURE_* when NOT verified (nil when verified)
#   provider:       the provider name, for the CZID-331 evidence record
#   attestation_ref, asserted_country: coarse evidence (NOT precise coordinates — TODO(counsel): privacy)
#
# FAIL-CLOSED: a nil/blank/expired/spoofed/malformed token, a bad signature, or any provider error MUST
# yield status "failed" (with a failure_reason) — never "verified". No allow-on-uncertainty.
module ExportControl
  module DeviceLocationProvider
    Result = Struct.new(:status, :failure_reason, :provider, :attestation_ref, :asserted_country,
                        keyword_init: true)

    # The fail-closed default. When AppConfig::DEVICE_LOCATION_PROVIDER is unset/blank the provider resolves
    # here (reference stub -> never verifies -> deny), so behaviour is unchanged until an operator opts in.
    DEFAULT_PROVIDER = "reference_stub".freeze

    module_function

    def verify_token(token, ctx = {})
      provider_module.verify_token(token, ctx)
    end

    # Read from AppConfig at runtime so go-live (and rollback) is a config row, not a deploy.
    def provider_name
      AppConfigHelper.get_app_config(AppConfig::DEVICE_LOCATION_PROVIDER, DEFAULT_PROVIDER)
    end

    def provider_module
      case provider_name
      when "geocomply" then Providers::Geocomply
      else
        # Any unknown/blank value (and the "reference_stub" default) FAILS CLOSED to the stub.
        Providers::DeviceReferenceStub
      end
    end
  end
end

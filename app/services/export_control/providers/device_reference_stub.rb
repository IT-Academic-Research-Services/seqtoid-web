# CZID-286 — reference device-location provider stub (server-side token verifier). Mirrors the Layer-2
# edge reference provider: a working skeleton behind PROVIDER, NOT a committed vendor, NO live calls.
#
# It does a SHAPE-ONLY, fail-closed evaluation of the token and NEVER returns "verified": until a real
# vendor (GeoComply) verifier is wired, every attestation is treated as unverified so the gate denies. A
# real module (providers/geocomply.rb) would verify the token's cryptographic signature against the
# vendor's key, check freshness (not expired) + the anti-spoof flags, extract the coarse asserted country,
# and RAISE / return "failed" on any error.
#
# The GeoComply verifier is Providers::Geocomply; this stub stays the fail-closed default.
module ExportControl
  module Providers
    module DeviceReferenceStub
      module_function

      def verify_token(token, _ctx = {})
        # Structurally-obvious rejects, mapped to fail-closed reasons (evidence only; still "failed").
        if token.nil? || token.to_s.strip.empty?
          return failed(DeviceLocationAttestation::FAILURE_MALFORMED)
        end

        # No real signature key is configured in the stub → we cannot affirmatively verify → fail closed.
        # (A real provider verifies the signature here and only then may return "verified".)
        failed(DeviceLocationAttestation::FAILURE_INVALID_SIGNATURE)
      end

      def failed(reason)
        ExportControl::DeviceLocationProvider::Result.new(
          status: DeviceLocationAttestation::STATUS_FAILED,
          failure_reason: reason,
          provider: "reference_stub",
          attestation_ref: nil,
          asserted_country: nil
        )
      end
    end
  end
end

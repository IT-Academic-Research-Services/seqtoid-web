# CZID-285 -- reference denied-party SCREENING provider stub. Mirrors the Layer-2 edge reference provider
# (spur.mjs): a working skeleton behind the DeniedPartyScreeningProvider swap point, NOT a committed vendor
# and NOT a live call.
#
# It performs NO network I/O (no live vendor calls -- standing rule) and, critically, returns PENDING --
# never a synthetic "clear". That keeps the fail-closed gate DENYING until a real, DPA-backed vendor
# (Descartes / Visual Compliance) is wired in via a sibling provider module (Providers::Descartes /
# Providers::ScreeningServiceHttp). A real module would: call the vendor, read back the screen decision,
# map it onto ExportControlClearance::SCREENING_RESULTS, and RAISE on any error/timeout (fail-closed).
#
# NOTE: this stub previously also carried the document-IDV half of the contract (`verify`). That lane was
# retired (approval = attestation + Visual Compliance, no document-IDV), so only the screening half remains.
#
# TODO(counsel/vendor): replace with the procurement-chosen screening vendor module + its DPA-approved flow.
module ExportControl
  module Providers
    module ReferenceStub
      module_function

      # The screening half of the contract (DeniedPartyScreeningProvider). Returns PENDING -> deny.
      def screen(_user, _ctx = {})
        ExportControl::DeniedPartyScreeningProvider::Result.new(
          result: ExportControlClearance::SCREENING_PENDING,
          provider: "reference_stub",
          evidence_ref: nil
        )
      end
    end
  end
end

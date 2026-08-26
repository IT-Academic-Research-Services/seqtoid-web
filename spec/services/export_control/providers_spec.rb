require 'rails_helper'

# CZID-285/286 — the provider-agnostic adapters + reference stubs. The load-bearing guarantee: the
# committed reference stubs NEVER return a pass (no synthetic clear), so the fail-closed gate stays
# DENYING until a real, DPA-backed vendor is wired. No live network calls (standing rule). The
# document-IDV lane was retired (approval = attestation + Visual Compliance, no document-IDV).
RSpec.describe "ExportControl providers (fail-closed by construction)", type: :model do
  let(:user) { create(:user) }

  describe ExportControl::DeniedPartyScreeningProvider do
    it "resolves the reference stub by default" do
      expect(described_class.provider_module).to eq(ExportControl::Providers::ReferenceStub)
    end

    it "returns PENDING (never clear) so the gate denies" do
      res = described_class.screen(user)
      expect(res.result).to eq(ExportControlClearance::SCREENING_PENDING)
      expect(res.result).not_to eq(ExportControlClearance::SCREENING_CLEAR)
    end
  end

  describe ExportControl::DeviceLocationProvider do
    it "resolves the reference stub by default" do
      expect(described_class.provider_module).to eq(ExportControl::Providers::DeviceReferenceStub)
    end

    it "returns FAILED (never verified) for a blank token — malformed" do
      res = described_class.verify_token("")
      expect(res.status).to eq(DeviceLocationAttestation::STATUS_FAILED)
      expect(res.failure_reason).to eq(DeviceLocationAttestation::FAILURE_MALFORMED)
    end

    it "returns FAILED (never verified) for a non-empty token — no signing key wired" do
      res = described_class.verify_token("some.attestation.token")
      expect(res.status).to eq(DeviceLocationAttestation::STATUS_FAILED)
      expect(res.status).not_to eq(DeviceLocationAttestation::STATUS_VERIFIED)
      expect(res.failure_reason).to eq(DeviceLocationAttestation::FAILURE_INVALID_SIGNATURE)
    end
  end
end

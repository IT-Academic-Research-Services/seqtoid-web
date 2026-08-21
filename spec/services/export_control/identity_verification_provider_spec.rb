# frozen_string_literal: true

require "rails_helper"

# Verifies the IDV allow-table (EXPORT_CONTROL_IDV_WHITELIST): a counsel-cleared identity is VERIFIED
# with no vendor call, everything else falls through to the fail-closed reference stub (PENDING). Without
# this path verify() can only ever PENDING, so no user can clear the gate (passed? = verified AND clear).
RSpec.describe ExportControl::IdentityVerificationProvider do
  let(:user) { double("User", id: 42, email: "alice@ucsf.edu") }

  def set_idv_whitelist(entries)
    AppConfigHelper.set_app_config(AppConfig::EXPORT_CONTROL_IDV_WHITELIST, JSON.dump(entries))
  end

  describe ".whitelisted?" do
    it "is empty by default -- nobody is verified (fail-closed)" do
      expect(described_class.whitelisted?(user)).to be(false)
    end

    it "is false for a nil user" do
      set_idv_whitelist(["ucsf.edu"])
      expect(described_class.whitelisted?(nil)).to be(false)
    end

    it "matches an explicit subject_ref (case-insensitive)" do
      set_idv_whitelist(["User:42"])
      expect(described_class.whitelisted?(user)).to be(true)
    end

    it "matches an email domain, bare or @-prefixed" do
      set_idv_whitelist(["ucsf.edu"])
      expect(described_class.whitelisted?(user)).to be(true)
      set_idv_whitelist(["@ucsf.edu"])
      expect(described_class.whitelisted?(user)).to be(true)
    end

    it "does not match a different subject or domain" do
      set_idv_whitelist(["User:99", "stanford.edu"])
      expect(described_class.whitelisted?(user)).to be(false)
    end
  end

  describe ".verify" do
    it "returns VERIFIED (provider=whitelist, no vendor call) for a whitelisted identity" do
      set_idv_whitelist(["ucsf.edu"])
      result = described_class.verify(user)
      expect(result.status).to eq(ExportControlClearance::VERIFICATION_VERIFIED)
      expect(result.provider).to eq("whitelist")
    end

    it "falls through to the fail-closed reference stub (PENDING) when not whitelisted" do
      result = described_class.verify(user)
      expect(result.status).to eq(ExportControlClearance::VERIFICATION_PENDING)
      expect(result.provider).to eq("reference_stub")
    end
  end
end

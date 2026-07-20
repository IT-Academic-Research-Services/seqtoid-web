require "rails_helper"

# Branch sweep for ExportControl::ScreeningPolicy (CZID-600, export-control fail-closed).
# The main spec proves the conservative defaults and the common allow-table hits, but a
# few arms of the WL/AL whitelist matcher stay untaken:
#   - whitelisted?: the ref.present? == FALSE arm (blank/nil subject_ref) that falls
#     through to the email-domain match.
#   - whitelisted?: the "@domain" entry form (e == "@#{domain}") vs the bare-domain form.
#   - whitelist: the Array() wrap of a non-array config value and the reject(&:blank?) arm.
# AppConfigHelper is stubbed so these run without touching the DB and stay deterministic.
RSpec.describe ExportControl::ScreeningPolicy do
  describe ".whitelist (normalization arms)" do
    it "lowercases, strips, and rejects blank entries" do
      allow(AppConfigHelper).to receive(:get_json_app_config).and_return(["  UCSF.edu ", "", "   "])
      expect(described_class.whitelist).to eq(["ucsf.edu"])
    end

    it "wraps a non-array config value via Array()" do
      allow(AppConfigHelper).to receive(:get_json_app_config).and_return("Solo.EDU")
      expect(described_class.whitelist).to eq(["solo.edu"])
    end
  end

  describe ".whitelisted? (matcher arms not hit by the main spec)" do
    it "matches by email domain when subject_ref is blank (ref.present? == false)" do
      allow(AppConfigHelper).to receive(:get_json_app_config).and_return(["ucsf.edu"])
      expect(described_class.whitelisted?("", "jane@ucsf.edu")).to be(true)
      expect(described_class.whitelisted?(nil, "jane@ucsf.edu")).to be(true)
    end

    it "matches an allow-table entry stored WITH a leading @ against a bare domain" do
      allow(AppConfigHelper).to receive(:get_json_app_config).and_return(["@ucsf.edu"])
      # ref is not on the table, so the match must come from the '@domain' arm.
      expect(described_class.whitelisted?("User:1", "jane@ucsf.edu")).to be(true)
    end

    it "does not match when neither the ref nor the domain is on the table" do
      allow(AppConfigHelper).to receive(:get_json_app_config).and_return(["ucsf.edu"])
      expect(described_class.whitelisted?("User:1", "jane@evil.test")).to be(false)
    end
  end
end

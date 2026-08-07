require 'rails_helper'

# SMP-1685 — the screening PROVIDER is runtime-configurable (AppConfig::EXPORT_CONTROL_SCREENING_PROVIDER)
# so go-live (and rollback) is a config row, not a deploy. The load-bearing guarantee is unchanged: any
# unknown/blank/unset value FAILS CLOSED to the reference stub (PENDING => deny). No config value opens a
# permissive path. No live network calls (standing rule).
RSpec.describe ExportControl::DeniedPartyScreeningProvider, type: :model do
  let(:user) { create(:user) }

  # Stub the config read exactly as provider_name issues it (key + fail-closed default).
  def stub_provider(value)
    allow(AppConfigHelper).to receive(:get_app_config)
      .with(AppConfig::EXPORT_CONTROL_SCREENING_PROVIDER, described_class::DEFAULT_PROVIDER)
      .and_return(value)
  end

  describe ".provider_module (config-driven, fail-closed)" do
    it "resolves ReferenceStub when the provider is unset (get_app_config returns the default)" do
      stub_provider(described_class::DEFAULT_PROVIDER)
      expect(described_class.provider_module).to eq(ExportControl::Providers::ReferenceStub)
    end

    it "routes to Descartes when the provider is set to \"descartes\"" do
      stub_provider("descartes")
      expect(described_class.provider_module).to eq(ExportControl::Providers::Descartes)
    end

    it "FAILS CLOSED to ReferenceStub on an unknown provider value" do
      stub_provider("totally_unknown_vendor")
      expect(described_class.provider_module).to eq(ExportControl::Providers::ReferenceStub)
    end

    it "FAILS CLOSED to ReferenceStub on a blank provider value" do
      stub_provider("")
      expect(described_class.provider_module).to eq(ExportControl::Providers::ReferenceStub)
    end
  end

  describe ".screen" do
    it "returns PENDING (never clear) via the reference stub when unset — the gate denies" do
      stub_provider(described_class::DEFAULT_PROVIDER)
      res = described_class.screen(user)
      expect(res.result).to eq(ExportControlClearance::SCREENING_PENDING)
      expect(res.result).not_to eq(ExportControlClearance::SCREENING_CLEAR)
    end
  end
end

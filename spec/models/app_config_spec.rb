require 'rails_helper'

RSpec.describe AppConfig, type: :model do
  let(:memory_store) { ActiveSupport::Cache.lookup_store(:memory_store) }

  before do
    allow(Rails).to receive(:cache).and_return(memory_store)
    Rails.cache.clear
  end

  context "persistence" do
    it "persists a key/value pair" do
      config = AppConfig.create!(key: AppConfig::MAX_OBJECTS_BULK_DOWNLOAD, value: "500")
      expect(config).to be_persisted
      expect(AppConfig.find_by(key: AppConfig::MAX_OBJECTS_BULK_DOWNLOAD).value).to eq("500")
    end
  end

  context "#clear_cached_record" do
    it "deletes the cached record for its key after save" do
      key = AppConfig::DISABLE_SITE_FOR_MAINTENANCE
      cache_key = "app_config-#{key}"
      Rails.cache.write(cache_key, "stale")

      AppConfig.create!(key: key, value: "1")

      expect(Rails.cache.read(cache_key)).to be_nil
    end

    it "clears the cache again on a subsequent update" do
      key = AppConfig::SHOW_EMERGENCY_BANNER_MESSAGE
      config = AppConfig.create!(key: key, value: "0")

      cache_key = "app_config-#{key}"
      Rails.cache.write(cache_key, "stale")

      config.update!(value: "1")

      expect(Rails.cache.read(cache_key)).to be_nil
    end
  end

  context "constants" do
    it "exposes stable string keys used elsewhere in the app" do
      expect(AppConfig::ENABLE_EXPORT_CONTROL_ATTESTATION).to eq("enable_export_control_attestation")
      expect(AppConfig::ENABLE_EXPORT_CONTROL_LAYER3).to eq("enable_export_control_layer3")
      expect(AppConfig::DISABLE_SITE_FOR_MAINTENANCE).to eq("disable_site_for_maintenance")
      expect(AppConfig::MAX_OBJECTS_BULK_DOWNLOAD).to eq("max_objects_bulk_download")
    end
  end
end

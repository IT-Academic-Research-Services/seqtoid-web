require 'rails_helper'

# The device-location provider is chosen by AppConfig at runtime; anything but "geocomply" fails closed to
# the reference stub, which never verifies.
RSpec.describe ExportControl::DeviceLocationProvider do
  it "defaults to the reference stub when unset" do
    expect(described_class.provider_name).to eq("reference_stub")
    expect(described_class.provider_module).to eq(ExportControl::Providers::DeviceReferenceStub)
  end

  it "selects GeoComply when the AppConfig row says so" do
    AppConfigHelper.set_app_config(AppConfig::DEVICE_LOCATION_PROVIDER, "geocomply")
    expect(described_class.provider_module).to eq(ExportControl::Providers::Geocomply)
  end

  it "fails closed to the stub for an unknown value" do
    AppConfigHelper.set_app_config(AppConfig::DEVICE_LOCATION_PROVIDER, "something-else")
    expect(described_class.provider_module).to eq(ExportControl::Providers::DeviceReferenceStub)
  end
end

require "rails_helper"

RSpec.describe DevPinHelper, type: :helper do
  def with_pin(env, &block)
    vars = { "DEV_PIN_KIND" => nil, "DEV_PIN_HOLDER" => nil, "DEV_PIN_EXPIRES_AT" => nil, "DEV_PIN_RC" => nil }.merge(env)
    ClimateControl.modify(vars, &block)
  end

  it "returns nil when DEV_PIN_KIND is absent, none or unknown" do
    with_pin({}) { expect(helper.dev_pin_banner).to be_nil }
    with_pin("DEV_PIN_KIND" => "none") { expect(helper.dev_pin_banner).to be_nil }
    with_pin("DEV_PIN_KIND" => "bogus", "DEV_PIN_HOLDER" => "x") { expect(helper.dev_pin_banner).to be_nil }
  end

  it "describes a lease with holder and expiry" do
    with_pin("DEV_PIN_KIND" => "lease", "DEV_PIN_HOLDER" => "jsims", "DEV_PIN_EXPIRES_AT" => "2026-11-10T17:00:00-05:00") do
      banner = helper.dev_pin_banner
      expect(banner.kind).to eq("lease")
      expect(banner.holder).to eq("jsims")
      expect(banner.expires_at).to eq(Time.utc(2026, 11, 10, 22, 0, 0))
    end
  end

  it "tolerates a lease with no holder or an unparseable expiry" do
    with_pin("DEV_PIN_KIND" => "LEASE", "DEV_PIN_EXPIRES_AT" => "tomorrow-ish") do
      banner = helper.dev_pin_banner
      expect(banner.holder).to eq("someone")
      expect(banner.expires_at).to be_nil
    end
  end

  it "describes an rc pin" do
    with_pin("DEV_PIN_KIND" => "rc", "DEV_PIN_RC" => "rc-2026-11-11") do
      expect(helper.dev_pin_banner).to have_attributes(kind: "rc", rc: "rc-2026-11-11")
    end
  end
end

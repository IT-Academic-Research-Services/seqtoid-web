require "rails_helper"
require "./lib/resque_schedule_loader"

RSpec.describe ResqueScheduleLoader do
  let(:path) { Rails.root.join("config", "resque_schedule.yml") }
  let(:full) { YAML.load_file(path) }

  it "returns the full schedule when RESQUE_SCHEDULE_EXCLUDE is unset" do
    expect(described_class.load(path, {})).to eq(full)
  end

  it "returns the full schedule when RESQUE_SCHEDULE_EXCLUDE is blank" do
    expect(described_class.load(path, { "RESQUE_SCHEDULE_EXCLUDE" => " , " })).to eq(full)
  end

  it "drops the named entries and keeps the rest" do
    loaded = described_class.load(path, { "RESQUE_SCHEDULE_EXCLUDE" => "ResolveScreeningHolds" })

    expect(loaded).not_to have_key("ResolveScreeningHolds")
    expect(loaded.keys).to match_array(full.keys - ["ResolveScreeningHolds"])
  end

  it "accepts several names with surrounding whitespace" do
    loaded = described_class.load(path, { "RESQUE_SCHEDULE_EXCLUDE" => " ResolveScreeningHolds , EnforceDataRetention " })

    expect(loaded).not_to have_key("ResolveScreeningHolds")
    expect(loaded).not_to have_key("EnforceDataRetention")
    expect(loaded).to have_key("HandleSfnNotificationsTimeout")
  end

  it "warns about unknown names instead of silently excluding nothing" do
    expect(described_class).to receive(:warn).with(/unknown schedule\(s\): ResolveScreeningHold$/)

    loaded = described_class.load(path, { "RESQUE_SCHEDULE_EXCLUDE" => "ResolveScreeningHold" })
    expect(loaded).to eq(full)
  end
end

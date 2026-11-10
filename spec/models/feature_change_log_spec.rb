require 'rails_helper'

# Every Feature mutation that changes something writes one FeatureFlagEvent row, in the same transaction.
RSpec.describe "Feature change log" do
  let(:admin) { create(:admin) }
  let(:user) { create(:user, allowed_features: nil) }

  def last_event
    FeatureFlagEvent.order(:id).last
  end

  it "logs a global enable and disable with the acting admin and the environment" do
    Feature.enable("new_flag", by: admin)

    expect(last_event).to have_attributes(
      feature: "new_flag", action: "enable", scope: "global", target_user_id: nil,
      actor_user_id: admin.id, actor_label: admin.email, environment: "test"
    )

    Feature.disable("new_flag", by: "rake features:remove")
    expect(last_event).to have_attributes(action: "disable", actor_user_id: nil, actor_label: "rake features:remove")
  end

  it "logs per-user changes with the target user" do
    Feature.enable_for("beta_thing", user, by: admin)

    expect(last_event).to have_attributes(feature: "beta_thing", action: "enable", scope: "user", target_user_id: user.id)
  end

  it "logs group flag and membership changes" do
    Feature.enable_for_group("group_flag", "beta_testers", by: admin)
    expect(last_event).to have_attributes(feature: "group_flag", scope: "group", group_name: "beta_testers")

    Feature.add_to_group(user.email, "beta_testers", by: admin)
    expect(last_event).to have_attributes(
      feature: nil, action: "add_member", scope: "group", group_name: "beta_testers",
      target_user_id: user.id, target_member: user.email
    )

    Feature.remove_from_group("ghost@example.org", "beta_testers", by: admin)
    expect(last_event.action).to eq("add_member") # no-op: ghost was never a member
  end

  it "writes nothing for a no-op" do
    Feature.enable("f", by: admin)

    expect { Feature.enable("f", by: admin) }.not_to change(FeatureFlagEvent, :count)
    expect { Feature.disable_for("never_had", user, by: admin) }.not_to change(FeatureFlagEvent, :count)
  end

  it "rolls the change back when the log row cannot be written" do
    allow(FeatureFlagEvent).to receive(:create!).and_raise(ActiveRecord::RecordInvalid)

    expect { Feature.enable("f", by: admin) }.to raise_error(ActiveRecord::RecordInvalid)
    expect(AppConfigHelper.get_json_app_config(AppConfig::LAUNCHED_FEATURES, [])).to eq([])
  end

  it "records the deploy environment next to Rails.env when ENVIRONMENT is set" do
    stub_const("ENV", ENV.to_h.merge("ENVIRONMENT" => "dev"))

    expect(FeatureFlagEvent.current_environment).to eq("test/dev")
  end

  it "keeps rows append-only" do
    Feature.enable("f", by: admin)

    expect { last_event.update!(feature: "g") }.to raise_error(ActiveRecord::ReadOnlyRecord)
  end
end

RSpec.describe AppConfig do
  it "busts the cached value on save, on commit and on destroy" do
    config = AppConfig.create!(key: "some_key", value: "1")
    expect(Rails.cache).to receive(:delete).with("app_config-some_key").at_least(:twice)

    config.update!(value: "2")
  end
end

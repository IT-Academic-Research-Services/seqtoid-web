require 'rails_helper'

RSpec.describe Feature do
  let(:admin) { create(:admin) }
  let(:user) { create(:user, email: "beta.person@example.org", allowed_features: JSON.dump(["own_grant"])) }
  let(:other) { create(:user, allowed_features: nil) }

  def launched
    AppConfigHelper.get_json_app_config(AppConfig::LAUNCHED_FEATURES, [])
  end

  describe ".enabled?" do
    before { AppConfigHelper.set_json_app_config(AppConfig::LAUNCHED_FEATURES, ["global_flag"]) }

    it "is true for a launched flag with or without a user" do
      expect(Feature.enabled?(:global_flag)).to be(true)
      expect(Feature.enabled?("global_flag", other)).to be(true)
    end

    it "is true for a per-user grant only for that user" do
      expect(Feature.enabled?("own_grant", user)).to be(true)
      expect(Feature.enabled?("own_grant", other)).to be(false)
      expect(Feature.enabled?("own_grant")).to be(false)
    end

    it "is false for an unknown flag" do
      expect(Feature.enabled?("nope", user)).to be(false)
    end
  end

  describe "User delegation (one evaluation path)" do
    it "routes allowed_feature? and allowed_feature_list through Feature" do
      expect(Feature).to receive(:enabled?).with("x", user).and_return(true)
      expect(user.allowed_feature?("x")).to be(true)

      expect(Feature).to receive(:enabled_list).with(user).and_return(["y"])
      expect(user.allowed_feature_list).to eq(["y"])
    end
  end

  describe "global enable / disable" do
    it "launches and un-launches a flag and reports whether anything changed" do
      expect(Feature.enable(:new_flag, by: admin)).to be(true)
      expect(Feature.enable(:new_flag, by: admin)).to be(false)
      expect(launched).to eq(["new_flag"])
      expect(Feature.enabled?("new_flag", other)).to be(true)

      expect(Feature.disable("new_flag", by: "rake")).to be(true)
      expect(Feature.disable("new_flag", by: "rake")).to be(false)
      expect(launched).to eq([])
    end

    it "requires an actor" do
      expect { Feature.enable("f", by: nil) }.to raise_error(ArgumentError)
      expect { Feature.enable("f", by: " ") }.to raise_error(ArgumentError)
    end
  end

  describe "per-user enable_for / disable_for" do
    it "changes only the user's own column, never copying launched flags into it" do
      AppConfigHelper.set_json_app_config(AppConfig::LAUNCHED_FEATURES, ["global_flag"])

      expect(Feature.enable_for("beta_thing", user, by: admin)).to be(true)
      expect(JSON.parse(user.reload.allowed_features)).to eq(["own_grant", "beta_thing"])

      expect(Feature.disable_for("own_grant", user, by: admin)).to be(true)
      expect(Feature.disable_for("global_flag", user, by: admin)).to be(false)
      expect(JSON.parse(user.reload.allowed_features)).to eq(["beta_thing"])
    end
  end

  describe "beta_testers group" do
    before { Feature.enable_for_group("group_flag", :beta_testers, by: admin) }

    it "is off for everyone until a user is a member" do
      expect(Feature.enabled?("group_flag", user)).to be(false)
    end

    it "matches members by user id" do
      Feature.add_to_group(user.id.to_s, "beta_testers", by: admin)

      expect(AppConfigHelper.get_json_app_config(AppConfig::FEATURE_GROUP_BETA_TESTERS_MEMBERS)).to eq([user.id])
      expect(Feature.enabled?("group_flag", user)).to be(true)
      expect(Feature.enabled?("group_flag", other)).to be(false)
      expect(user.allowed_feature_list).to include("group_flag", "own_grant")
    end

    it "matches members by email, case-insensitively" do
      Feature.add_to_group(" Beta.Person@Example.org", "beta_testers", by: admin)

      expect(AppConfigHelper.get_json_app_config(AppConfig::FEATURE_GROUP_BETA_TESTERS_MEMBERS)).to eq(["beta.person@example.org"])
      expect(Feature.enabled?("group_flag", user)).to be(true)
    end

    it "honours a hand-edited AppConfig member list" do
      AppConfigHelper.set_json_app_config(AppConfig::FEATURE_GROUP_BETA_TESTERS_MEMBERS, [other.id, "BETA.PERSON@example.org"])

      expect(Feature.enabled?("group_flag", user)).to be(true)
      expect(Feature.enabled?("group_flag", other)).to be(true)
    end

    it "turns off on remove_from_group and disable_for_group" do
      Feature.add_to_group(user, "beta_testers", by: admin)
      expect(Feature.remove_from_group(user.id, "beta_testers", by: admin)).to be(true)
      expect(Feature.enabled?("group_flag", user)).to be(false)

      Feature.add_to_group(user, "beta_testers", by: admin)
      Feature.disable_for_group("group_flag", "beta_testers", by: admin)
      expect(Feature.enabled?("group_flag", user)).to be(false)
    end

    it "rejects an unknown group" do
      expect { Feature.enable_for_group("f", "nobody", by: admin) }.to raise_error(KeyError)
    end
  end

  describe ".list" do
    it "unions the registry, launched, group and per-user flags with their state" do
      AppConfigHelper.set_json_app_config(AppConfig::LAUNCHED_FEATURES, ["sorting_v0", "launched_only"])
      Feature.enable_for_group("group_only", "beta_testers", by: admin)
      user

      statuses = Feature.list.index_by(&:name)

      expect(statuses.keys).to include(*Feature::REGISTRY.keys, "launched_only", "group_only", "own_grant")
      expect(statuses["sorting_v0"].global).to be(true)
      expect(statuses["sorting_v0"].description).to be_present
      expect(statuses["AMR"].global).to be(false)
      expect(statuses["group_only"].groups).to eq(["beta_testers"])
      expect(statuses["own_grant"].users).to eq([{ id: user.id, email: user.email }])
    end
  end

  describe ".store" do
    it "can be swapped for another backend without touching call sites" do
      fake = instance_double(Feature::AppConfigStore, launched: ["from_fake"])
      original = Feature.store
      Feature.store = fake
      expect(Feature.enabled?("from_fake")).to be(true)
    ensure
      Feature.store = original
    end
  end
end

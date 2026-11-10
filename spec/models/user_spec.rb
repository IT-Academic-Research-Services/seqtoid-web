require 'rails_helper'

LAUNCHED_FEATURES = ["feature_1", "feature_2"].freeze
USER_FEATURES = ["feature_1", "feature_3"].freeze

describe User, type: :model do
  context "#allowed_feature_list" do
    subject { user.allowed_feature_list }

    context "if user has allowed features" do
      let(:user) { create(:user, allowed_features: JSON.dump(USER_FEATURES)) }

      context "if launched features configured" do
        let!(:app_config) { create(:app_config, key: AppConfig::LAUNCHED_FEATURES, value: JSON.dump(LAUNCHED_FEATURES)) }
        it "shows merged features" do
          expect(subject).to contain_exactly("feature_1", "feature_2", "feature_3")
        end
      end

      context "if launched features is nil" do
        it "returns only user allowed features" do
          expect(subject).to contain_exactly("feature_1", "feature_3")
        end
      end
    end

    context "if user has nil allowed features " do
      let(:user) { create(:user) }
      let!(:app_config) { create(:app_config, key: AppConfig::LAUNCHED_FEATURES, value: JSON.dump(LAUNCHED_FEATURES)) }

      it "return only launched features" do
        expect(subject).to contain_exactly("feature_1", "feature_2")
      end
    end
  end

  context "#add_allowed_feature / #remove_allowed_feature with launched features" do
    let!(:app_config) { create(:app_config, key: AppConfig::LAUNCHED_FEATURES, value: JSON.dump(["launched_a", "launched_b"])) }
    let(:user) { create(:user, allowed_features: JSON.dump(["own_grant"])) }

    it "stores only the user's own grants, never the global launched list" do
      user.add_allowed_feature("new_grant")

      expect(JSON.parse(user.reload.allowed_features)).to eq(["own_grant", "new_grant"])
    end

    it "lets an un-launch take effect for a user who later had another feature added" do
      user.add_allowed_feature("new_grant")
      expect(user.reload.allowed_feature?("launched_a")).to be(true)

      AppConfigHelper.set_json_app_config(AppConfig::LAUNCHED_FEATURES, ["launched_b"])

      expect(user.reload.allowed_feature?("launched_a")).to be(false)
      expect(user.allowed_feature?("launched_b")).to be(true)
      expect(user.allowed_feature?("new_grant")).to be(true)
    end

    it "does not copy launched features into the column when removing a grant" do
      user.remove_allowed_feature("own_grant")

      expect(JSON.parse(user.reload.allowed_features)).to eq([])
    end

    it "leaves the column alone when removing a feature that is only launched globally" do
      user.remove_allowed_feature("launched_a")

      expect(JSON.parse(user.reload.allowed_features)).to eq(["own_grant"])
      expect(user.allowed_feature?("launched_a")).to be(true)
    end
  end

  context "#salt" do
    subject { user.salt }

    before do
      @user = create(:user)
    end

    let!(:user) { @user }

    it "generates a salt for the user" do
      expect(subject.length).to eq(24)
    end
  end
end

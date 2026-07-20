require "rails_helper"

# Branch sweep for ApplicationHelper. The existing application_helper_spec covers
# escape_json's script-escaping; this file targets the branches it does NOT reach:
# the backslash-present arm of escape_json, and every current_user ternary/&&
# short-circuit in user_context (plus its ||= memoization). Each example flips a
# single branch so mutating it changes the assertion. Spec-only.
RSpec.describe ApplicationHelper, type: :helper do
  describe "#escape_json backslash guard" do
    it "double-escapes embedded backslashes when the serialized JSON contains one" do
      # to_json of a value containing a literal backslash yields a string that
      # `include? "\\"` is true for, taking the gsub! arm.
      result = helper.escape_json("path" => "a\\b")
      expect(result).to include("\\\\")
      expect { result }.not_to raise_error
    end

    it "leaves a backslash-free payload without the extra escaping arm" do
      result = helper.escape_json("plain" => "no backslash here")
      expect(result).not_to include("\\\\")
    end
  end

  describe "#user_context" do
    before { allow(AppConfigHelper).to receive(:configs_for_context).and_return({}) }

    context "when there is no current_user" do
      before { allow(helper).to receive(:current_user).and_return(nil) }

      it "uses the anonymous defaults (false / [] / nil / not-signed-in)" do
        ctx = helper.user_context
        expect(ctx[:admin]).to be(false)
        expect(ctx[:allowedFeatures]).to eq([])
        expect(ctx[:firstSignIn]).to be_nil
        expect(ctx[:userId]).to be_nil
        expect(ctx[:userName]).to be_nil
        expect(ctx[:userEmail]).to be_nil
        expect(ctx[:userSignedIn]).to be(false)
      end
    end

    context "when an admin user (role == 1) is signed in on their first visit" do
      let(:user) do
        instance_double(
          User,
          role: 1,
          allowed_feature_list: ["feature_a"],
          sign_in_count: 1,
          id: 7,
          name: "Ada",
          email: "ada@example.com",
          present?: true
        )
      end

      before { allow(helper).to receive(:current_user).and_return(user) }

      it "marks admin true, firstSignIn true, and threads the identity fields" do
        ctx = helper.user_context
        expect(ctx[:admin]).to be(true)
        expect(ctx[:allowedFeatures]).to eq(["feature_a"])
        expect(ctx[:firstSignIn]).to be(true)
        expect(ctx[:userId]).to eq(7)
        expect(ctx[:userName]).to eq("Ada")
        expect(ctx[:userEmail]).to eq("ada@example.com")
        expect(ctx[:userSignedIn]).to be(true)
      end
    end

    context "when a non-admin returning user (role != 1, sign_in_count > 1) is signed in" do
      let(:user) do
        instance_double(
          User,
          role: 0,
          allowed_feature_list: [],
          sign_in_count: 5,
          id: 9,
          name: "Bo",
          email: "bo@example.com",
          present?: true
        )
      end

      before { allow(helper).to receive(:current_user).and_return(user) }

      it "marks admin false and firstSignIn false" do
        ctx = helper.user_context
        expect(ctx[:admin]).to be(false)
        expect(ctx[:firstSignIn]).to be(false)
        expect(ctx[:userSignedIn]).to be(true)
      end
    end

    context "memoization" do
      let(:user) do
        instance_double(
          User,
          role: 1,
          allowed_feature_list: [],
          sign_in_count: 1,
          id: 1,
          name: "M",
          email: "m@example.com",
          present?: true
        )
      end

      before { allow(helper).to receive(:current_user).and_return(user) }

      it "computes the context once and returns the cached object on the second call" do
        first = helper.user_context
        expect(AppConfigHelper).to have_received(:configs_for_context).once
        expect(helper.user_context).to equal(first)
        # still only one computation despite two calls (the ||= cached arm)
        expect(AppConfigHelper).to have_received(:configs_for_context).once
      end
    end
  end
end

# frozen_string_literal: true

require 'rails_helper'

# Branch sweep for UsersController. The existing request spec covers the
# admin_required gate, the feature-flag endpoints and the two authorization
# guards on update_user_data. This file drives the arms it leaves untaken:
#
#   #create                    - the Net::SMTPAuthenticationError rescue and the
#                                generic StandardError rescue.
#   #update                    - the Auth0 patch condition on both arms and the
#                                validation-failure branch.
#   #update_user_data          - the admin short-circuit of both guards, the
#                                "nothing Auth0 cares about changed" arm, and the
#                                update-failed branch.
#   #post_user_data_to_airtable- LOCAL_USER_PROFILE on/off, the
#                                AUTO_ACCOUNT_CREATION_V1 gate, and the
#                                profile_form_version presence check.
#
# NOTE: the `if current_user.admin?` bodies in #feature_flags / #feature_flag are
# not exercised on their false arm here: `before_action :admin_required` already
# redirects non-admins before the action runs, so the else arm is unreachable
# through the routed stack.
RSpec.describe "Users request branches", type: :request do
  create_users

  before do
    @auth0_management_client_double = double("Auth0Client")
    allow(Auth0UserManagementHelper).to receive(:auth0_management_client).and_return(@auth0_management_client_double)
    allow(Auth0UserManagementHelper).to receive(:patch_auth0_user)
    allow(Auth0UserManagementHelper).to receive(:delete_auth0_user)
  end

  describe "POST /users (create)" do
    it "creates the user and renders it as JSON" do
      sign_in @admin
      created = create(:user, email: "made@example.com", name: "Made User")
      allow(UserFactoryService).to receive(:call).and_return(created)

      post "/users.json", params: { user: { email: "made@example.com", name: "Made User" } }

      expect(response).to have_http_status(:created)
      expect(JSON.parse(response.body)["email"]).to eq("made@example.com")
    end

    it "explains the SMTP misconfiguration when activation email cannot be sent" do
      sign_in @admin
      allow(UserFactoryService).to receive(:call).and_raise(Net::SMTPAuthenticationError.new("no auth"))

      post "/users.json", params: { user: { email: "smtp@example.com", name: "SMTP User" } }

      expect(response).to have_http_status(:internal_server_error)
      expect(JSON.parse(response.body).first).to include("SMTP email is not configured")
    end

    it "renders any other failure as a 422" do
      sign_in @admin
      allow(UserFactoryService).to receive(:call).and_raise(StandardError, "kaboom")

      post "/users.json", params: { user: { email: "bad@example.com" } }

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.body).to include("kaboom")
    end
  end

  describe "PUT /users/:id (update)" do
    it "patches Auth0 when the identity fields change" do
      sign_in @admin
      old_email = @joe.email

      # patch_auth0_user takes old_email:, email:, name:, role: as REQUIRED keywords,
      # and the controller slices them straight out of the submitted params, so all
      # three must be present for this arm to run.
      put "/users/#{@joe.id}.json",
          params: { user: { email: "renamed-joe@example.com", name: "Renamed Joe", role: 0 } }

      expect(response).to have_http_status(:ok)
      expect(@joe.reload.name).to eq("Renamed Joe")
      expect(@joe.email).to eq("renamed-joe@example.com")
      expect(Auth0UserManagementHelper).to have_received(:patch_auth0_user)
        .with(old_email: old_email, email: "renamed-joe@example.com", name: "Renamed Joe", role: "0")
    end

    it "skips the Auth0 patch when no identity field is supplied" do
      sign_in @admin

      put "/users/#{@joe.id}.json", params: { user: { institution: "UCSF" } }

      expect(response).to have_http_status(:ok)
      expect(@joe.reload.institution).to eq("UCSF")
      expect(Auth0UserManagementHelper).not_to have_received(:patch_auth0_user)
    end

    it "returns the validation errors when the update is rejected" do
      sign_in @admin
      # A duplicate email trips the User uniqueness validation.
      put "/users/#{@joe.id}.json", params: { user: { email: @admin.email } }

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body).join(" ")).to match(/email/i)
      expect(Auth0UserManagementHelper).not_to have_received(:patch_auth0_user)
    end
  end

  describe "POST /users/feature_flag with an unrecognized action" do
    it "leaves every user's flags alone when the action is neither add nor remove" do
      sign_in @admin
      @joe.add_allowed_feature("kept_flag")
      @joe.save!

      post "/users/feature_flag", params: {
        feature_flag_action: "toggle",
        feature_flag: "kept_flag",
        user_emails: [@joe.email],
      }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["featureFlagAction"]).to eq("toggle")
      expect(body["usersWithUpdatedFeatureFlags"]).to eq([@joe.email])
      # Neither the add nor the remove arm ran, so the flag is untouched.
      expect(@joe.reload.allowed_feature?("kept_flag")).to be(true)
    end
  end

  describe "POST /users/:id/update_user_data" do
    it "lets an admin update another user without the AUTO_ACCOUNT_CREATION_V1 flag" do
      # Both `!current_user.admin? && ...` guards short-circuit on the admin check.
      AppConfigHelper.set_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1, "0")
      sign_in @admin

      post "/users/#{@joe.id}/update_user_data", params: { user: { name: "Admin Renamed" } }

      expect(response).to have_http_status(:ok)
      expect(@joe.reload.name).to eq("Admin Renamed")
      expect(Auth0UserManagementHelper).to have_received(:patch_auth0_user)
    end

    it "skips the Auth0 patch when neither email nor name is supplied" do
      AppConfigHelper.set_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1, "1")
      sign_in @joe

      post "/users/#{@joe.id}/update_user_data", params: { user: { profile_form_version: "2" } }

      expect(response).to have_http_status(:ok)
      expect(Auth0UserManagementHelper).not_to have_received(:patch_auth0_user)
    end

    it "reaches the failure branch when the update is rejected (which then blows up on respond_to)" do
      AppConfigHelper.set_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1, "1")
      sign_in @joe

      # The else arm's `respond_to do |_format|` block never registers a format, so
      # respond_to has no collector to hand back and raises. Pinning that here both
      # exercises the branch and documents the defect (a rejected update 500s
      # instead of returning the 422 the code intends).
      expect do
        post "/users/#{@joe.id}/update_user_data", params: { user: { email: @admin.email } }
      end.to raise_error(ActionController::UnknownFormat)

      expect(@joe.reload.email).not_to eq(@admin.email)
    end
  end

  describe "POST /users/:id/post_user_data_to_airtable" do
    before { allow(UsersHelper).to receive(:send_profile_form_to_airtable) }

    it "is forbidden when AUTO_ACCOUNT_CREATION_V1 is off and local profiles are off" do
      AppConfigHelper.set_app_config(AppConfig::LOCAL_USER_PROFILE, "0")
      AppConfigHelper.set_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1, "0")
      sign_in @joe

      post "/users/#{@joe.id}/post_user_data_to_airtable", params: { user: { profile_form_version: "2" } }

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["message"]).to eq("AUTO_ACCOUNT_CREATION_V1 is not enabled")
      expect(UsersHelper).not_to have_received(:send_profile_form_to_airtable)
    end

    it "saves a local UserProfile when LOCAL_USER_PROFILE is enabled (then double-renders)" do
      AppConfigHelper.set_app_config(AppConfig::LOCAL_USER_PROFILE, "1")
      AppConfigHelper.set_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1, "1")
      sign_in @joe

      # The LOCAL_USER_PROFILE arm renders "saved locally" but does not return, so
      # the action falls through to the AirTable render and Rails raises. The row
      # is still written first, which is what this asserts; the raise documents the
      # missing `return` in that branch.
      expect do
        expect do
          post "/users/#{@joe.id}/post_user_data_to_airtable",
               params: { user: { profile_form_version: "2", first_name: "Joe", country: "USA" } }
        end.to raise_error(AbstractController::DoubleRenderError)
      end.to change(UserProfile, :count).by(1)

      profile = UserProfile.order(:id).last
      expect(profile.user_id).to eq(@joe.id)
      expect(profile.first_name).to eq("Joe")
    end

    it "posts to Airtable without a local profile when LOCAL_USER_PROFILE is off" do
      AppConfigHelper.set_app_config(AppConfig::LOCAL_USER_PROFILE, "0")
      AppConfigHelper.set_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1, "1")
      sign_in @joe

      expect do
        post "/users/#{@joe.id}/post_user_data_to_airtable", params: { user: { profile_form_version: "2" } }
      end.not_to change(UserProfile, :count)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["message"]).to eq("User data successfully posted to AirTable")
      expect(UsersHelper).to have_received(:send_profile_form_to_airtable)
    end

    it "skips the Airtable post when no profile_form_version is supplied" do
      AppConfigHelper.set_app_config(AppConfig::LOCAL_USER_PROFILE, "0")
      AppConfigHelper.set_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1, "1")
      sign_in @joe

      post "/users/#{@joe.id}/post_user_data_to_airtable", params: { user: { country: "USA" } }

      expect(response).to have_http_status(:ok)
      expect(UsersHelper).not_to have_received(:send_profile_form_to_airtable)
    end
  end
end

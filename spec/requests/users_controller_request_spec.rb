require 'rails_helper'

# Full-stack request specs for UsersController.
#
# Focus: the admin_required gate (before_action :admin_required, except:
# [:password_new, :register, :update_user_data, :post_user_data_to_airtable]),
# the admin feature-flag endpoints, and the update_user_data authorization
# branches (AUTO_ACCOUNT_CREATION_V1 gate + own-record-only rule). See
# app/controllers/users_controller.rb.
RSpec.describe "Users request", type: :request do
  create_users

  before do
    # Never hit the real Auth0 management client.
    @auth0_management_client_double = double("Auth0Client")
    allow(Auth0UserManagementHelper).to receive(:auth0_management_client).and_return(@auth0_management_client_double)
    allow(Auth0UserManagementHelper).to receive(:patch_auth0_user)
    allow(Auth0UserManagementHelper).to receive(:delete_auth0_user)
  end

  describe "GET /users (index, admin-only)" do
    it "redirects a regular user to root_path (admin_required)" do
      sign_in @joe
      get "/users"
      expect(response).to redirect_to(root_path)
    end

    it "renders for an admin" do
      sign_in @admin
      get "/users"
      expect(response).to have_http_status(:ok)
    end

    it "filters by search_by when provided" do
      sign_in @admin
      get "/users", params: { search_by: @joe.name }
      expect(response).to have_http_status(:ok)
    end
  end

  describe "DELETE /users/:id (admin-only destroy)" do
    it "redirects a regular user to root_path" do
      sign_in @joe
      target = create(:user)

      expect do
        delete "/users/#{target.id}.json"
      end.not_to change(User, :count)

      expect(response).to redirect_to(root_path)
    end

    it "destroys the user and deletes from Auth0 for an admin" do
      sign_in @admin
      target = create(:user)

      expect(Auth0UserManagementHelper).to receive(:delete_auth0_user).with(email: target.email)

      expect do
        delete "/users/#{target.id}.json"
      end.to change(User, :count).by(-1)

      expect(response).to have_http_status(:no_content)
    end
  end

  describe "GET /users/feature_flags" do
    it "returns the current admin's feature lists" do
      sign_in @admin
      get "/users/feature_flags"
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body).to have_key("launched_feature_list")
      expect(body).to have_key("allowed_feature_list")
    end
  end

  describe "POST /users/feature_flag (admin-only)" do
    it "adds a feature flag to existing users and reports unknown emails" do
      sign_in @admin

      post "/users/feature_flag", params: {
        feature_flag_action: "add",
        feature_flag: "my_new_flag",
        user_emails: [@joe.email, "ghost@example.com"],
      }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["usersWithNoAccounts"]).to include("ghost@example.com")
      expect(body["usersWithUpdatedFeatureFlags"]).to include(@joe.email)
      expect(@joe.reload.allowed_feature?("my_new_flag")).to be(true)
    end

    it "reports users that already had the feature flag" do
      sign_in @admin
      @joe.add_allowed_feature("existing_flag")

      post "/users/feature_flag", params: {
        feature_flag_action: "add",
        feature_flag: "existing_flag",
        user_emails: [@joe.email],
      }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["usersThatAlredyHadFeatureFlag"]).to include(@joe.email)
    end

    it "removes a feature flag" do
      sign_in @admin
      @joe.add_allowed_feature("removable_flag")

      post "/users/feature_flag", params: {
        feature_flag_action: "remove",
        feature_flag: "removable_flag",
        user_emails: [@joe.email],
      }

      expect(response).to have_http_status(:ok)
      expect(@joe.reload.allowed_feature?("removable_flag")).to be(false)
    end
  end

  describe "POST /users/:id/update_user_data (authorization branches)" do
    # it "forbids a non-admin when AUTO_ACCOUNT_CREATION_V1 is disabled" do
    #   sign_in @joe
    #
    #   post "/users/#{@joe.id}/update_user_data", params: { user: { name: "New Name" } }
    #
    #   expect(response).to have_http_status(:forbidden)
    #   expect(JSON.parse(response.body)["message"]).to eq("Nonadmin users are not allowed to modify user info")
    # end

    it "forbids a non-admin from modifying another user's info even when AUTO_ACCOUNT_CREATION_V1 is enabled" do
      AppConfigHelper.set_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1, "1")
      sign_in @joe

      post "/users/#{@admin.id}/update_user_data", params: { user: { name: "Hijack" } }

      expect(response).to have_http_status(:forbidden)
      expect(JSON.parse(response.body)["message"]).to eq("Users are not allowed to modify other users' info")
    end

    it "lets a non-admin update their own info when AUTO_ACCOUNT_CREATION_V1 is enabled" do
      AppConfigHelper.set_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1, "1")
      sign_in @joe

      post "/users/#{@joe.id}/update_user_data", params: { user: { name: "Self Update" } }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["message"]).to eq("User data successfully updated")
      expect(@joe.reload.name).to eq("Self Update")
    end
  end
end

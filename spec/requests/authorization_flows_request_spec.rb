require 'rails_helper'

# Cross-cutting authorization/authentication flow request specs.
#
# These pin down the app-wide auth contract that lives in ApplicationController
# (authenticate_user! + admin_required) and is easy to regress when controllers
# are refactored:
#
#   * Unauthenticated HTML requests REDIRECT to the auth0 login flow.
#   * Unauthenticated JSON requests get 401 with {errors: ['Not Authenticated']}.
#   * admin_required endpoints redirect a regular user to root_path.
#
# The format-dependent 401-vs-redirect split is exactly the kind of behavior a
# "just assert 200" test never catches. See app/controllers/application_controller.rb
# (#authenticate_user!, #admin_required) and app/controllers/users_controller.rb.
RSpec.describe "Authorization flows", type: :request do
  create_users

  describe "unauthenticated access is format-aware" do
    it "returns 401 JSON for an unauthenticated JSON API request" do
      get "/samples/stats.json", params: { domain: "my_data" }

      # Through the FULL request/middleware stack (unlike a controller spec), an
      # unauthenticated request is intercepted by the Warden failure_app wired up
      # in config/initializers/auth0.rb, which renders {error: 'Unauthorized',
      # code: 401} with a 401 status and Content-Type application/json. The
      # ApplicationController#authenticate_user! JSON branch ({errors: ['Not
      # Authenticated']}) is the controller-level fallback and is only reached
      # when the request bypasses that middleware (controller specs); it does not
      # run here. We pin the real behavior: a 401 JSON response, not a data leak.
      expect(response).to have_http_status(:unauthorized)
      expect(response.media_type).to eq("application/json")
      # Assert the body is WELL-FORMED JSON, not just that it contains the word
      # "Unauthorized". The regression this guards (SMP-1490 / DEV-RAILS-PROJECT-27)
      # was a failure_app that returned a raw Ruby Hash (and a String status) as the
      # Rack body: Hash#each yields [k, v] Arrays, so Puma's fast_write_response
      # raised `NoMethodError: undefined method 'bytesize' for an Array`, and the
      # client got the hash pairs rendered as text. A bare `include("Unauthorized")`
      # matched that malformed body and let the bug ship; JSON.parse does not.
      parsed = JSON.parse(response.body)
      expect(parsed).to eq("error" => "Unauthorized", "code" => 401)
    end

    it "redirects an unauthenticated HTML request to the auth0 login flow" do
      get "/home"

      expect(response).to have_http_status(:redirect)
      expect(response).to redirect_to(controller: :auth0, action: :login)
    end
  end

  describe "admin_required endpoints" do
    context "GET /users (admin-only index)" do
      it "redirects a regular user to root_path" do
        sign_in @joe
        get "/users"
        expect(response).to redirect_to(root_path)
      end

      it "allows an admin to load the user index" do
        sign_in @admin
        get "/users"
        expect(response).to have_http_status(:ok)
      end
    end

    context "DELETE /users/:id (admin-only destroy)" do
      it "does not let a regular user delete another user" do
        sign_in @joe
        victim = create(:user)

        expect do
          delete "/users/#{victim.id}"
        end.not_to change(User, :count)

        expect(response).to redirect_to(root_path)
        expect(User.exists?(victim.id)).to be(true)
      end
    end
  end

  describe "regular vs admin scoping on a shared endpoint (projects index)" do
    before do
      @joe_project = create(:project, users: [@joe], public_access: 0)
      @admin_private = create(:project, users: [@admin], public_access: 0)
    end

    it "a regular user does not see another user's private project in the JSON index" do
      sign_in @joe
      get "/projects.json", params: { domain: "my_data", listAllIds: true }

      expect(response).to have_http_status(:ok)
      all_ids = JSON.parse(response.body)["all_projects_ids"] || []
      expect(all_ids).to include(@joe_project.id)
      expect(all_ids).not_to include(@admin_private.id)
    end

    it "an admin sees other users' projects in the JSON index" do
      sign_in @admin
      get "/projects.json", params: { domain: "all_data", listAllIds: true }

      expect(response).to have_http_status(:ok)
      all_ids = JSON.parse(response.body)["all_projects_ids"] || []
      expect(all_ids).to include(@joe_project.id)
    end
  end
end

require 'rails_helper'

# Branch-coverage spec for IdentityController.
#
# Targets branches the existing identity_controller_spec.rb does NOT exercise:
#   * enrich_token_for_admin: both arms of `if include_headers`
#   * impersonate: the UserNotFoundError arm (`unless User.exists?(user_id)`)
#   * validate_token: the InvalidAuthorizationScheme arm (scheme != "Bearer")
#   * the custom error classes' `error.present?` message-composition arms
#
# TEST-ONLY. Mutation-checked. The token-signing key at /tmp is provisioned once per
# shard by spec/support/token_signing_key.rb, matching the existing identity spec.
RSpec.describe IdentityController, type: :controller do
  create_users

  describe "GET #enrich_token_for_admin (admin-only)" do
    before { sign_in @admin }

    it "returns a bare token when include_headers is not 'true'" do
      get :enrich_token_for_admin, params: { user_id: @joe.id }
      token = JSON.parse(response.body)["token"]
      expect(response).to have_http_status(:success)
      # Bare token -> NOT wrapped in an Authorization-header JSON envelope.
      expect(token).not_to include("Authorization")
    end

    it "wraps the token in an Authorization header envelope when include_headers == 'true'" do
      get :enrich_token_for_admin, params: { user_id: @joe.id, include_headers: "true" }
      token = JSON.parse(response.body)["token"]
      expect(response).to have_http_status(:success)
      expect(token).to include("\"Authorization\": \"Bearer ")
    end
  end

  describe "GET #impersonate user-existence guard" do
    before do
      sign_in @joe
      service_identity_token = TokenCreationService.call(service_identity: "workflows")["token"]
      request.headers["Authorization"] = "Bearer #{service_identity_token}"
    end

    it "raises UserNotFoundError when the impersonation target does not exist" do
      # service_identity is present (passes the privileges guard) but user_id 0 has no
      # matching user -> the `unless User.exists?(user_id)` arm fires.
      expect do
        get :impersonate, params: { user_id: 0 }
      end.to raise_error(IdentityController::UserNotFoundError)
    end
  end

  describe "validate_token authorization-scheme guard" do
    before do
      sign_in @joe
      token = TokenCreationService.call(user_id: @joe.id)["token"]
      # Non-Bearer scheme exercises `unless authorization_scheme == "Bearer"`.
      request.headers["Authorization"] = "Basic #{token}"
    end

    it "raises InvalidAuthorizationScheme for a non-Bearer scheme" do
      expect do
        get :enrich_token
      end.to raise_error(IdentityController::InvalidAuthorizationScheme)
    end
  end

  describe "custom error message composition" do
    it "appends the provided detail when present, and omits it when blank" do
      expect(IdentityController::TokenCreationError.new("boom").message).to include("boom")
      expect(IdentityController::TokenCreationError.new.message).not_to include("Error:")

      expect(IdentityController::InvalidTokenError.new("nope").message).to include("nope")
      expect(IdentityController::InvalidTokenError.new.message).not_to include("Error:")
    end
  end
end

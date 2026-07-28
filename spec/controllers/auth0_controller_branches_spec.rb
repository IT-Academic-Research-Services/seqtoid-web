require "rails_helper"

# Branch coverage for Auth0Controller arms the existing auth0 specs never reach:
#   * refresh_token: both arms of the silent-vs-interactive prompt ternary, and
#     filter_value's "value is in the whitelist" arm
#   * callback: missing omniauth.auth, the authenticated-but-no-DB-user arm, the
#     mode dispatch (background_refresh / expired / reset_password), the
#     "don't touch login counters" arm, and the not-authenticated -> logout arm
#   * request_password_reset: blank email, known email, unknown email
#   * background_refresh_values: with and without a decodable token
#
# Uses an anonymous subclass + an isolated route table (the repo's
# auth0_controller_actions_spec pattern) so nothing here touches the app routes.
RSpec.describe Auth0Controller, type: :controller do
  controller(Auth0Controller) do
  end

  before do
    routes.draw do
      root to: "auth0#refresh_token"
      get "auth0/refresh_token" => "auth0#refresh_token"
      get "auth0/background_refresh" => "auth0#background_refresh"
      get "auth0/callback" => "auth0#callback"
      post "auth0/request_password_reset" => "auth0#request_password_reset"
      get "auth0/login" => "auth0#login", as: :auth0_login
      get "home" => "auth0#refresh_token", as: :home
    end
    allow_any_instance_of(Auth0Helper).to receive(:auth0_signout_url)
      .and_return("https://auth0.example.test/v2/logout")
    allow_any_instance_of(Auth0Helper).to receive(:auth0_invalidate_application_session)
  end

  describe "#refresh_token" do
    it "asks Auth0 for a SILENT login when the mode is a background/expired refresh" do
      get :refresh_token, params: { mode: "expired" }

      expect(assigns(:mode)).to eq("expired")
      expect(assigns(:prompt)).to eq("none")
      expect(assigns(:connection)).to eq(Auth0Controller::AUTH0_CONNECTION_NAME)
    end

    it "asks Auth0 for an INTERACTIVE login for the login mode" do
      get :refresh_token, params: { mode: "login" }

      expect(assigns(:mode)).to eq("login")
      expect(assigns(:prompt)).to eq("login")
    end

    it "drops a mode that is not in the supported whitelist" do
      get :refresh_token, params: { mode: "not_a_supported_mode" }

      expect(assigns(:mode)).to be_nil
      expect(assigns(:prompt)).to eq("login")
    end
  end

  describe "#callback" do
    let(:user) { create(:user) }

    def stub_authentication(result)
      allow_any_instance_of(Auth0Helper).to receive(:auth0_authenticate_with_bearer_token).and_return(result)
    end

    def stub_current_user(value)
      allow_any_instance_of(ApplicationController).to receive(:current_user).and_return(value)
    end

    it "tolerates a missing omniauth.auth payload and still authenticates with an empty token" do
      stub_current_user(user)
      allow(user).to receive(:update_tracked_fields!)
      expect_any_instance_of(Auth0Helper).to receive(:auth0_authenticate_with_bearer_token)
        .with({}).and_return(true)
      request.env["omniauth.params"] = { "mode" => "login" }

      get :callback

      expect(response).to redirect_to(home_path)
    end

    it "rejects a login whose user row is missing from the database" do
      stub_authentication(true)
      stub_current_user(nil)
      expect(LogUtil).to receive(:log_error)
        .with("User logged in on Auth0 but entry is missing from database.")
      request.env["omniauth.params"] = { "mode" => "login" }

      get :callback

      expect(response).to have_http_status(:bad_request)
      expect(response.body).to include("Your account does not exist on this server")
    end

    it "redirects to the background refresh action without touching login counters" do
      stub_authentication(true)
      stub_current_user(user)
      expect(user).not_to receive(:update_tracked_fields!)
      request.env["omniauth.params"] = { "mode" => "background_refresh" }

      get :callback

      expect(response).to redirect_to("/auth0/background_refresh")
    end

    it "redirects home for the expired mode without bumping the login counters" do
      stub_authentication(true)
      stub_current_user(user)
      expect(user).not_to receive(:update_tracked_fields!)
      request.env["omniauth.params"] = { "mode" => "expired" }

      get :callback

      expect(response).to redirect_to(home_path)
    end

    it "updates login counters for the login mode" do
      stub_authentication(true)
      stub_current_user(user)
      expect(user).to receive(:update_tracked_fields!)
      request.env["omniauth.params"] = { "mode" => "login" }

      get :callback

      expect(response).to redirect_to(home_path)
    end

    it "redirects to root after a password reset" do
      stub_authentication(true)
      stub_current_user(user)
      allow(user).to receive(:update_tracked_fields!)
      request.env["omniauth.params"] = { "mode" => "reset_password" }

      get :callback

      expect(response).to redirect_to(root_path)
    end

    it "logs out when Auth0 did not authenticate the bearer token" do
      stub_authentication(false)
      stub_current_user(nil)
      request.env["omniauth.params"] = { "mode" => "login" }

      get :callback

      expect(response).to redirect_to("https://auth0.example.test/v2/logout")
    end
  end

  describe "#request_password_reset" do
    it "does nothing at all when no email was supplied" do
      expect(Auth0UserManagementHelper).not_to receive(:send_auth0_password_reset_email)
      expect(UserMailer).not_to receive(:no_account_found)

      post :request_password_reset, params: { user: { email: "" } }

      expect(response).to have_http_status(:no_content)
    end

    it "sends the Auth0 reset email for a known account" do
      user = create(:user)
      expect(Auth0UserManagementHelper).to receive(:send_auth0_password_reset_email).with(user.email)
      expect(UserMailer).not_to receive(:no_account_found)

      post :request_password_reset, params: { user: { email: user.email } }

      expect(response).to redirect_to(auth0_login_path)
    end

    it "sends the no-account-found email for an unknown address (no account enumeration)" do
      mailer = double("mail", deliver_now: true)
      expect(UserMailer).to receive(:no_account_found).with("nobody@example.com").and_return(mailer)
      expect(Auth0UserManagementHelper).not_to receive(:send_auth0_password_reset_email)

      post :request_password_reset, params: { user: { email: "nobody@example.com" } }

      expect(response).to redirect_to(auth0_login_path)
    end
  end

  describe "#background_refresh" do
    it "derives refresh timings from a decodable token" do
      now = Time.now.to_i
      allow_any_instance_of(Auth0Helper).to receive(:auth0_decode_auth_token).and_return(
        authenticated: true,
        auth_payload: { "exp" => now + 3600, "iat" => now - 3600 }
      )

      get :background_refresh, params: { mode: "background_refresh" }

      values = assigns(:refresh_values)
      expect(values[:lifespan]).to eq(7200)
      expect(values[:expired]).to be(false)
      # expires_in (~3600) - lifespan/2 (3600) <= 0 -> due for a preemptive refresh.
      expect(values[:should_refresh]).to be(true)
      # a quarter of the lifespan, clamped between MIN and MAX
      expect(values[:reload_wait_seconds]).to eq(1800)
    end

    it "defaults iat from the max refresh window when the token omits it" do
      now = Time.now.to_i
      allow_any_instance_of(Auth0Helper).to receive(:auth0_decode_auth_token).and_return(
        authenticated: true,
        auth_payload: { "exp" => now + 3600 }
      )

      get :background_refresh, params: { mode: "background_refresh" }

      values = assigns(:refresh_values)
      expect(values[:lifespan]).to eq(Auth0Controller::MAX_TOKEN_REFRESH_IN_SECONDS)
      expect(values[:expired]).to be(false)
    end

    it "reports an expired, refresh-now state when there is no decodable token" do
      allow_any_instance_of(Auth0Helper).to receive(:auth0_decode_auth_token).and_return(nil)

      get :background_refresh, params: { mode: "background_refresh" }

      values = assigns(:refresh_values)
      expect(values[:lifespan]).to eq(0)
      expect(values[:should_refresh]).to be(true)
      expect(values[:expired]).to be(true)
      expect(values[:exp]).to eq(0)
      expect(values[:iat]).to eq(0)
      expect(values[:reload_wait_seconds]).to eq(Auth0Controller::MIN_TOKEN_REFRESH_IN_SECONDS)
    end
  end
end

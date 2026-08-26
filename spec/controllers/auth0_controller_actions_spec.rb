require "rails_helper"

# Coverage Wave 2 -- the two Auth0Controller actions that have no ordinary route:
#   * dev_login       -- routed ONLY in development (config/routes.rb), so it
#                        cannot be reached from a request spec in the test env.
#   * omniauth_failure -- not routed at all; invoked as a Rack action from
#                        OmniAuth's on_failure hook (config/initializers/auth0.rb).
#
# Both are exercised through an anonymous subclass of Auth0Controller. Drawing a
# route on an anonymous controller (the repo's ExportControlLayer3Gate pattern)
# keeps the temporary route scoped to this spec -- it does NOT mutate the shared
# application route table.
RSpec.describe Auth0Controller, type: :controller do
  controller(Auth0Controller) do
    # Inherits dev_login and omniauth_failure from Auth0Controller.
  end

  before do
    # An anonymous subclass of a *named* controller keeps controller_path "auth0",
    # so the test-only routes target auth0#... The route set here is isolated to
    # this controller spec and does not touch the application route table.
    #
    # NOTE: drawing `dev_login` here is a TEST-ONLY convenience so the action can
    # be dispatched to exercise its runtime guard. In the real app the route is
    # registered ONLY inside `if Rails.env.development? && ALLOW_DIRECT_USER_LOGIN`
    # (config/routes.rb); these specs assert the action's own guard independently.
    routes.draw do
      get "login" => "auth0#login"
      get "dev_login" => "auth0#dev_login"
      # auth0#login builds the fall-through redirect with url_for(action:
      # :refresh_token), which resolves against controller_path "auth0" ->
      # /auth0/refresh_token, so mount it under that path here.
      get "auth0/refresh_token" => "auth0#refresh_token"
      get "omniauth_failure" => "auth0#omniauth_failure"
    end
    # logout -> auth0_signout_url defaults its arg to root_url, which the
    # anonymous route table does not define. Stub the URL so the logout branches
    # under test redirect to a stable, assertable Auth0 signout URL.
    allow_any_instance_of(Auth0Helper).to receive(:auth0_signout_url)
      .and_return("https://auth0.example.test/v2/logout")
  end

  # Deny-by-default gate: the dev-only sign-in requires BOTH the development Rails
  # env AND the explicit ALLOW_DIRECT_USER_LOGIN=true opt-in flag. The deployed
  # dev cluster runs the development env and is internet-facing, so it must NOT
  # set the flag -- proven by the "development but flag unset -> 404" case below.
  def stub_env_and_flag(rails_env:, flag:)
    allow(Rails).to receive(:env).and_return(ActiveSupport::StringInquirer.new(rails_env))
    env_hash = ENV.to_hash
    if flag.nil?
      env_hash.delete("ALLOW_DIRECT_USER_LOGIN")
    else
      env_hash["ALLOW_DIRECT_USER_LOGIN"] = flag
    end
    stub_const("ENV", env_hash)
  end

  describe "#dev_login (fail-closed unless dev env AND ALLOW_DIRECT_USER_LOGIN)" do
    it "returns 404 in the test environment (Rails.env.development? is false)" do
      get :dev_login

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404 in development when the flag is UNSET (deny-by-default)" do
      # The internet-facing deployed dev cluster case: development Rails env, but
      # the opt-in flag is not set, so the action must refuse to run.
      stub_env_and_flag(rails_env: "development", flag: nil)
      FactoryBot.create(:admin, role: 1)

      get :dev_login

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404 when the flag is set but the env is NOT development" do
      stub_env_and_flag(rails_env: "production", flag: "true")
      FactoryBot.create(:admin, role: 1)

      get :dev_login

      expect(response).to have_http_status(:not_found)
    end

    context "when development AND ALLOW_DIRECT_USER_LOGIN=true (allow path)" do
      # This repo's `sign_in` helper stubs current_user rather than driving real
      # Warden middleware, so controller specs have no warden proxy. dev_login
      # calls warden.logout/set_user directly, so inject a warden double and
      # assert the seeded user is placed in the :auth0_user scope (what a real
      # Auth0 callback / ApplicationController#current_user uses).
      # `user` is stubbed too: ApplicationController#append_info_to_payload calls
      # current_user (-> warden.user(:auth0_user)) during request logging.
      let(:warden_double) { instance_double("Warden::Proxy", logout: nil, set_user: nil, user: nil) }

      before do
        stub_env_and_flag(rails_env: "development", flag: "true")
        allow_any_instance_of(Auth0Controller).to receive(:warden).and_return(warden_double)
      end

      it "signs in the seeded dev user (into the :auth0_user scope) and redirects home" do
        admin = FactoryBot.create(:admin, role: 1)
        expect(warden_double).to receive(:set_user).with(
          an_object_having_attributes(id: admin.id), scope: :auth0_user
        )

        get :dev_login

        expect(response).to redirect_to(home_path)
      end

      it "logs a traceability audit line before signing the user in (no untraceable logins)" do
        admin = FactoryBot.create(:admin, role: 1)
        # Tolerate unrelated framework warn calls; assert our audit line is emitted.
        allow(Rails.logger).to receive(:warn)
        expect(Rails.logger).to receive(:warn).with(
          a_string_matching(/DIRECT DEV LOGIN -- no Auth0.*id=#{admin.id}.*email=#{Regexp.escape(admin.email)}/)
        )

        get :dev_login
      end

      it "404s with a helpful message when no seeded user exists" do
        get :dev_login

        expect(response).to have_http_status(:not_found)
        expect(response.body).to include("no seeded user found")
      end
    end
  end

  describe "#login (Sign In hand-off gated on the same flag)" do
    it "does the normal Auth0 redirect and does NOT divert to dev_login in the test env" do
      get :login

      expect(response).to redirect_to("/auth0/refresh_token?mode=login")
      expect(response.location).not_to include("dev_login")
    end

    it "does the normal Auth0 redirect in development when the flag is UNSET" do
      stub_env_and_flag(rails_env: "development", flag: nil)

      get :login

      expect(response).to redirect_to("/auth0/refresh_token?mode=login")
      expect(response.location).not_to include("dev_login")
    end

    it "diverts Sign In to the dev login path when development AND the flag is set" do
      stub_env_and_flag(rails_env: "development", flag: "true")
      # The auth0_dev_login named helper only exists when the real dev route is
      # registered (dev env AND the flag); the isolated controller-spec route
      # table does not mix it into the controller, so stub it (bypassing partial-
      # double verification) to assert login's divert target.
      without_partial_double_verification do
        allow(controller).to receive(:auth0_dev_login_path).and_return("/auth0/dev_login")
      end

      get :login

      expect(response).to redirect_to("/auth0/dev_login")
    end
  end

  describe "#omniauth_failure" do
    it "logs out (redirects to signout) when the error is login_required" do
      get :omniauth_failure, params: { error: "login_required", error_description: "anything" }

      expect(response).to be_redirect
      expect(response.redirect_url).to include("/v2/logout")
    end

    it "renders the whitelisted explanation for a known unauthorized error_description" do
      get :omniauth_failure, params: { error: "unauthorized", error_description: "password_expired" }

      expect(response).to have_http_status(:ok)
      expect(assigns(:message)).to eq(Auth0Controller::ERROR_EXPLANATIONS[:password_expired])
    end

    it "falls back to the default explanation for an unknown unauthorized error_description" do
      get :omniauth_failure, params: { error: "unauthorized", error_description: "some_other_reason" }

      expect(response).to have_http_status(:ok)
      expect(assigns(:message)).to eq(Auth0Controller::ERROR_EXPLANATIONS[:default])
    end

    it "routes any other error type through failure -> logout" do
      get :omniauth_failure, params: { error: "access_denied", error_description: "nope" }

      expect(response).to be_redirect
      expect(response.redirect_url).to include("/v2/logout")
    end

    it "logs an error and renders the default message when error_description is missing" do
      expect(LogUtil).to receive(:log_error).with(
        "omniauth_failure called with missing error or error_description.",
        error_type: :unauthorized,
        error_description: :"",
        params: /"error"=>"unauthorized"/
      )

      # error is present (unauthorized) but error_description is absent: the guard
      # logs, then the empty error_code is not whitelisted, so :default renders.
      get :omniauth_failure, params: { error: "unauthorized" }

      expect(response).to have_http_status(:ok)
      expect(assigns(:message)).to eq(Auth0Controller::ERROR_EXPLANATIONS[:default])
    end

    it "logs an error and routes to failure when the error type is entirely missing" do
      expect(LogUtil).to receive(:log_error).with(
        "omniauth_failure called with missing error or error_description.",
        error_type: :"",
        error_description: :"",
        params: /"action"=>"omniauth_failure"/
      )

      get :omniauth_failure

      expect(response).to be_redirect
      expect(response.redirect_url).to include("/v2/logout")
    end
  end
end

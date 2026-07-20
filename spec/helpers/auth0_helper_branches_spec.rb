require "rails_helper"

# Branch sweep for Auth0Helper. The existing auth0_helper_spec covers the
# auth0_check_user_auth result matrix; this file targets the branches it does
# NOT reach: the admin wrong-role LOGGING guard, the two arms of
# auth0_authenticate_with_bearer_token, the present/blank/rescue arms of
# auth0_decode_auth_token, the ternary in the private auth0_session= writer,
# the http_token guard, and the CLI-vs-application arm of auth_token.
#
# Every example is written so that inverting or deleting the branch under test
# changes the asserted outcome (no vacuous passes). Spec-only.
RSpec.describe Auth0Helper, type: :helper do
  describe "#auth0_check_user_auth admin wrong-role logging guard" do
    let(:admin) { build_stubbed(:admin) }

    before do
      allow(helper).to receive(:auth0_decode_auth_token).and_return(decoded_token)
    end

    context "when the admin JWT lacks the admin role, is not expired, and email matches" do
      # wrong_role=true, expired=false, wrong_email=false -> the guard is true, so it LOGS.
      let(:decoded_token) do
        { authenticated: true, auth_payload: { "email" => admin.email } }
      end

      it "logs the wrong-role error and returns AUTH_INVALID_USER" do
        expect(LogUtil).to receive(:log_error)
          .with(a_string_including("Wrong auth0 role"), hash_including(user_email: admin.email))
          .once
        expect(helper.auth0_check_user_auth(admin)).to eq(Auth0Helper::AUTH_INVALID_USER)
      end
    end

    context "when the admin JWT lacks the admin role BUT the token is expired" do
      # wrong_role=true but expired=true -> the `&& !expired` arm short-circuits, so NO log.
      let(:decoded_token) do
        { authenticated: false, auth_payload: { "email" => admin.email } }
      end

      it "does NOT log and returns AUTH_TOKEN_EXPIRED (expired takes precedence)" do
        expect(LogUtil).not_to receive(:log_error)
        expect(helper.auth0_check_user_auth(admin)).to eq(Auth0Helper::AUTH_TOKEN_EXPIRED)
      end
    end
  end

  describe "#auth0_authenticate_with_bearer_token" do
    let(:warden) { instance_double(Warden::Proxy) }

    before do
      allow(helper).to receive(:auth0_session=)
      allow(helper).to receive(:warden).and_return(warden)
    end

    context "when the decoded token is authenticated" do
      let(:auth_user) { build_stubbed(:user) }

      before do
        allow(helper).to receive(:auth0_decode_auth_token)
          .and_return(authenticated: true, auth_payload: { "email" => auth_user.email })
        allow(User).to receive(:find_by).with(email: auth_user.email).and_return(auth_user)
      end

      it "logs out the prior scope, sets the auth0_user, and returns true" do
        expect(warden).to receive(:logout).with(:user)
        expect(warden).to receive(:set_user).with(auth_user, scope: :auth0_user)
        expect(helper.auth0_authenticate_with_bearer_token("bearer")).to be(true)
      end
    end

    context "when the decoded token is NOT authenticated" do
      before do
        allow(helper).to receive(:auth0_decode_auth_token).and_return(authenticated: false)
      end

      it "invalidates the application session and returns false" do
        expect(helper).to receive(:auth0_invalidate_application_session)
        expect(warden).not_to receive(:set_user)
        expect(helper.auth0_authenticate_with_bearer_token("bearer")).to be(false)
      end
    end
  end

  describe "#auth0_decode_auth_token" do
    it "wraps the payload as authenticated when auth_token yields a present payload" do
      allow(helper).to receive(:auth_token).and_return([{ "email" => "a@b.co" }, { "alg" => "RS256" }])

      result = helper.auth0_decode_auth_token
      expect(result).to eq(
        authenticated: true,
        auth_payload: { "email" => "a@b.co" },
        auth_header: { "alg" => "RS256" }
      )
    end

    it "returns NOT_AUTHENTICATED when the payload is blank" do
      # auth_token returns nil -> destructuring yields [nil, nil] -> payload not present.
      allow(helper).to receive(:auth_token).and_return(nil)
      expect(helper.auth0_decode_auth_token).to eq(Auth0Helper::NOT_AUTHENTICATED)
    end

    it "returns NOT_AUTHENTICATED when decoding raises a JWT error (rescue arm)" do
      allow(helper).to receive(:auth_token).and_raise(JWT::DecodeError.new("bad"))
      expect(helper.auth0_decode_auth_token).to eq(Auth0Helper::NOT_AUTHENTICATED)
    end
  end

  describe "#auth0_session= (private writer ternary)" do
    let(:store) { {} }

    before { allow(helper).to receive(:session).and_return(store) }

    it "stores the credentials minus the token when value AND id_token are present" do
      helper.send(:auth0_session=, "id_token" => "jwt", "token" => "opaque", "keep" => "yes")
      expect(store[:auth0_credentials]).to eq("id_token" => "jwt", "keep" => "yes")
    end

    it "stores nil when the value is present but id_token is missing" do
      helper.send(:auth0_session=, "token" => "opaque")
      expect(store[:auth0_credentials]).to be_nil
    end

    it "stores nil when the value itself is blank" do
      helper.send(:auth0_session=, nil)
      expect(store[:auth0_credentials]).to be_nil
    end
  end

  describe "#http_token (private guard)" do
    it "returns the id_token when the auth0 session is present" do
      allow(helper).to receive(:auth0_session).and_return("id_token" => "jwt")
      expect(helper.send(:http_token)).to eq("jwt")
    end

    it "returns nil when the auth0 session is absent" do
      allow(helper).to receive(:auth0_session).and_return(nil)
      expect(helper.send(:http_token)).to be_nil
    end
  end

  describe "#auth_token (private) CLI-vs-application arm" do
    before { allow(helper).to receive(:http_token).and_return("tok") }

    it "returns nil without verifying when there is no token" do
      allow(helper).to receive(:http_token).and_return(nil)
      expect(JsonWebToken).not_to receive(:verify_cli)
      expect(JsonWebToken).not_to receive(:verify_application)
      expect(helper.send(:auth_token)).to be_nil
    end

    it "verifies via the CLI path when @auth0_cli_auth is set" do
      helper.instance_variable_set(:@auth0_cli_auth, true)
      expect(JsonWebToken).to receive(:verify_cli).with("tok").and_return(%w[payload header])
      expect(JsonWebToken).not_to receive(:verify_application)
      expect(helper.send(:auth_token)).to eq(%w[payload header])
    end

    it "verifies via the application path when @auth0_cli_auth is falsey" do
      helper.instance_variable_set(:@auth0_cli_auth, nil)
      expect(JsonWebToken).to receive(:verify_application).with("tok").and_return(%w[payload header])
      expect(JsonWebToken).not_to receive(:verify_cli)
      expect(helper.send(:auth_token)).to eq(%w[payload header])
    end
  end
end

require 'rails_helper'

# SMP-1458: when an environment has no Basespace OAuth credentials, the oauth
# callback used to fall through to a nil access token and emit no telemetry at
# all. That produced a user-visible "Basespace upload issue" that left no trace
# anywhere, so it could never be diagnosed after the fact. These specs pin the
# loud behaviour: the misconfiguration is logged, and the configured path is
# unaffected.
RSpec.describe BasespaceController, type: :controller do
  create_users

  before { sign_in @joe }

  let(:oauth_env) do
    {
      "CZID_BASESPACE_OAUTH_REDIRECT_URI" => "MOCK_URI",
      "CZID_BASESPACE_CLIENT_ID" => "MOCK_ID",
      "CZID_BASESPACE_CLIENT_SECRET" => "MOCK_SECRET",
    }
  end

  describe "GET #oauth when Basespace is not configured" do
    BASESPACE_OAUTH_ENV_VARS.each do |missing_var|
      context "when #{missing_var} is unset" do
        before do
          stub_const('ENV', ENV.to_hash.merge(oauth_env).except(missing_var))
        end

        it "logs the misconfiguration naming the missing variable" do
          expect(LogUtil).to receive(:log_error)
            .with(
              a_string_including("BasespaceConfigurationError").and(a_string_including(missing_var)),
              hash_including(missing_env_vars: [missing_var])
            )

          get :oauth, params: { code: "MOCK_CODE" }
        end

        it "leaves the access token nil and never attempts the token exchange" do
          allow(LogUtil).to receive(:log_error)
          expect(HttpHelper).not_to receive(:post_json)

          get :oauth, params: { code: "MOCK_CODE" }

          expect(response).to render_template("oauth")
          expect(assigns(:access_token)).to be_nil
        end
      end

      context "when #{missing_var} is blank" do
        before do
          stub_const('ENV', ENV.to_hash.merge(oauth_env).merge(missing_var => ""))
        end

        # A blank string is truthy in Ruby, so a bare presence check would treat
        # this environment as configured and post an empty credential.
        it "treats a blank value as missing and does not attempt the token exchange" do
          allow(LogUtil).to receive(:log_error)
          expect(HttpHelper).not_to receive(:post_json)

          get :oauth, params: { code: "MOCK_CODE" }

          expect(assigns(:access_token)).to be_nil
        end
      end
    end
  end

  describe "GET #oauth when configured but no authorization code is returned" do
    before do
      stub_const('ENV', ENV.to_hash.merge(oauth_env))
    end

    it "logs the missing code rather than failing silently" do
      expect(LogUtil).to receive(:log_error)
        .with(a_string_including("BasespaceOauthError"))

      get :oauth, params: {}

      expect(assigns(:access_token)).to be_nil
    end
  end

  describe "GET #oauth when configured" do
    before do
      stub_const('ENV', ENV.to_hash.merge(oauth_env))
      allow(HttpHelper).to receive(:post_json).and_return("access_token" => "12345")
    end

    it "performs the token exchange and logs no configuration error" do
      expect(LogUtil).not_to receive(:log_error)

      get :oauth, params: { code: "MOCK_CODE" }

      expect(assigns(:access_token)).to eq("12345")
    end
  end

  describe BasespaceHelper do
    describe ".missing_oauth_env_vars" do
      it "is empty when every variable is present" do
        stub_const('ENV', ENV.to_hash.merge(oauth_env))
        expect(BasespaceHelper.missing_oauth_env_vars).to be_empty
        expect(BasespaceHelper).to be_oauth_configured
      end

      it "lists every unset variable" do
        stub_const('ENV', ENV.to_hash.except(*BASESPACE_OAUTH_ENV_VARS))
        expect(BasespaceHelper.missing_oauth_env_vars).to match_array(BASESPACE_OAUTH_ENV_VARS)
        expect(BasespaceHelper).not_to be_oauth_configured
      end
    end
  end
end

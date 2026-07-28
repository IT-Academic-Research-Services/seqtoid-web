require "rails_helper"
require Rails.root.join("lib", "auth0_login_config").to_s

RSpec.describe Auth0LoginConfig do
  describe ".authorize_params" do
    it "requests only the openid/email scope by default (no audience)" do
      expect(described_class.authorize_params({})).to eq(scope: "openid email")
    end

    # Regression guard (dev login outage 2026-07-28): AUTH0_CLI_AUDIENCE must NEVER influence the
    # web login /authorize request. It is a CLI-token-verification value; feeding it here injected
    # an invalid audience and broke sign-in for every user. If this test ever fails, the CLI/login
    # coupling has been reintroduced.
    it "ignores AUTH0_CLI_AUDIENCE entirely" do
      params = described_class.authorize_params({ "AUTH0_CLI_AUDIENCE" => "a-cli-client-id" })
      expect(params).not_to have_key(:audience)
      expect(params).to eq(scope: "openid email")
    end

    it "adds an audience only from the dedicated AUTH0_LOGIN_AUDIENCE var" do
      params = described_class.authorize_params({ "AUTH0_LOGIN_AUDIENCE" => "https://api.dev.example/" })
      expect(params[:audience]).to eq("https://api.dev.example/")
    end

    it "omits audience when AUTH0_LOGIN_AUDIENCE is blank" do
      expect(described_class.authorize_params({ "AUTH0_LOGIN_AUDIENCE" => "" })).to eq(scope: "openid email")
    end

    it "never lets AUTH0_CLI_AUDIENCE win even if AUTH0_LOGIN_AUDIENCE is also set" do
      params = described_class.authorize_params(
        { "AUTH0_CLI_AUDIENCE" => "cli-client-id", "AUTH0_LOGIN_AUDIENCE" => "https://api.dev.example/" }
      )
      expect(params[:audience]).to eq("https://api.dev.example/")
    end
  end
end

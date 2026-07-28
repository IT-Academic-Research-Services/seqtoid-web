require "rails_helper"

# Locks in the decoupling of the WEB login audience from AUTH0_CLI_AUDIENCE (dev login outage
# 2026-07-28). AUTH0_CLI_AUDIENCE is a CLI-token-verification value only (JsonWebToken.verify_cli);
# it used to ALSO be injected as the web login OmniAuth `audience`, so provisioning it for the CLI
# (an invalid API audience) broke sign-in for every user.
#
# The initializer must now build its authorize_params via Auth0LoginConfig -- whose behavior (audience
# comes only from the dedicated AUTH0_LOGIN_AUDIENCE, never from AUTH0_CLI_AUDIENCE) is unit-tested in
# spec/lib/auth0_login_config_spec.rb -- and must not reference AUTH0_CLI_AUDIENCE at all.
RSpec.describe "config/initializers/auth0.rb audience wiring" do
  let(:source) { Rails.root.join("config", "initializers", "auth0.rb").read }

  it "builds the login authorize_params via Auth0LoginConfig (decoupled from CLI config)" do
    expect(source).to include("authorize_params: Auth0LoginConfig.authorize_params")
  end

  it "does NOT read AUTH0_CLI_AUDIENCE in code (reading it would re-couple CLI config to web login)" do
    # Match the actual ENV access, not the word itself -- the explanatory comment names the var.
    expect(source).not_to match(/ENV\[\s*["']AUTH0_CLI_AUDIENCE["']\s*\]/)
  end
end

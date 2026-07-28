# frozen_string_literal: true

# Auth0LoginConfig builds the omniauth-auth0 authorize params for the WEB user login flow.
#
# The web login audience is DELIBERATELY decoupled from AUTH0_CLI_AUDIENCE. AUTH0_CLI_AUDIENCE is
# used ONLY to verify CLI bearer tokens (JsonWebToken.verify_cli). It was previously also fed into
# this /authorize request; when it was provisioned for the CLI it injected an invalid `audience`
# into every web login and broke sign-in for all users (dev outage 2026-07-28). The web login
# audience now has its own dedicated, single-purpose variable, AUTH0_LOGIN_AUDIENCE, which is unset
# in every environment today (so login behavior is unchanged) and is the ONLY input that can ever
# add an audience to the login request. CLI configuration can no longer affect web login.
module Auth0LoginConfig
  DEFAULT_SCOPE = "openid email"

  # Returns the authorize_params hash for the omniauth-auth0 provider.
  # `env` is injectable so the behavior can be unit-tested without touching the process ENV.
  def self.authorize_params(env = ENV)
    params = { scope: DEFAULT_SCOPE }
    login_audience = env["AUTH0_LOGIN_AUDIENCE"]
    params[:audience] = login_audience if login_audience.present?
    params
  end
end

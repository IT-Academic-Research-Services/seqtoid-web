require 'digest/sha1'

Rails.application.config.middleware.use Warden::Manager do |manager|
  # A Rack response is [Integer status, headers, body] where body responds to #each and yields
  # STRINGS. This previously returned a String status ('401') and a raw Hash body. Hash#each yields
  # [key, value] ARRAYS, so puma's fast_write_response called .bytesize on an Array and blew up with
  # NoMethodError (Sentry DEV-RAILS-PROJECT-27) -- and the client received the hash pairs rendered as
  # `[:error, "Unauthorized"][:code, 401]` instead of JSON, which surfaced as an unhandled promise
  # rejection in the frontend (Sentry DEV-REACTJS-PROJECT-1R). Serialize to JSON and wrap in an array.
  manager.failure_app = proc do |_env|
    [401, { 'Content-Type' => 'application/json' }, [{ error: 'Unauthorized', code: 401 }.to_json]]
  end
end

Warden::Manager.serialize_into_session do |user|
  # convert to warden_session_obj
  serialized = user.slice("id", "role")
  # extra field to improve security
  serialized["salt_hash"] = Digest::SHA1.hexdigest(user.salt || "")
  serialized
end

Warden::Manager.serialize_from_session do |warden_session_obj|
  return nil unless warden_session_obj.instance_of?(Hash)

  id, role, salt_hash = warden_session_obj.values_at("id", "role", "salt_hash")
  user = User.find_by(id: id, role: role)
  if user && salt_hash == Digest::SHA1.hexdigest(user.salt || "")
    user
  end
end

# This code provides routing mapper to authenticate routes
# ex:
# -- routes.rb --
#   authenticate :user, ->(u) { u.admin? } do
#     mount RESQUE_SERVER, at: "/resque"
#   end
module ActionDispatch::Routing
  class Mapper
    def authenticate(scope = nil, block = nil)
      constraint = lambda do |request|
        request.env['warden'].authenticated?(scope) && (block.nil? || block.call(request.env['warden'].user(scope)))
      end
      constraints(constraint) do
        yield
      end
    end
  end
end

Rails.application.config.middleware.use OmniAuth::Builder do
  # Auth0 now uses a custom DNS domain (auth.<env>.seqtoid.org) that differs from the Auth0
  # tenant domain, so login must request the correct `audience` for Management API (/api/v2/)
  # calls to be authorized. Ports jsims 95f2dbd98 (itars/development). Guarded on presence so
  # login is unchanged in any environment where AUTH0_CLI_AUDIENCE has not been provisioned yet
  # (the audience must be set per-env in chamber/SSM -- ops half of the same change).
  auth0_authorize_params = { scope: 'openid email' }
  auth0_authorize_params[:audience] = ENV["AUTH0_CLI_AUDIENCE"] if ENV["AUTH0_CLI_AUDIENCE"].present?

  provider(
    :auth0,
    ENV["AUTH0_CLIENT_ID"],
    ENV["AUTH0_CLIENT_SECRET"],
    ENV["AUTH0_DOMAIN"],
    callback_path: '/auth/auth0/callback',
    authorize_params: auth0_authorize_params
  )
end

OmniAuth.config.failure_raise_out_environments = []

OmniAuth.config.on_failure = proc do |env|
  Auth0Controller.action(:omniauth_failure).call(env)
end

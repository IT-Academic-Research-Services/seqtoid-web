class Mutations::CreateUser < Mutations::BaseMutation
  include GraphqlAuthHelpers

  # SMP-1709 -- clear, user-facing message returned when a logged-out visitor tries to self-register
  # in an environment where self-service signup is disabled (beta/staging/prod).
  SIGNUP_DISABLED_MESSAGE = "Self-service signup is disabled. Please request access to be invited.".freeze

  field :email, String, null: true

  def resolve(email:)
    auto_account_creation_enabled = AppConfigHelper.get_app_config(AppConfig::AUTO_ACCOUNT_CREATION_V1) == "1"

    if !current_user_is_logged_in?(context) && auto_account_creation_enabled
      # SMP-1709 -- self-service signup is gated per environment: disabled (fail-closed) in the
      # closed invite-only beta/staging/prod, enabled in dev. This is the authoritative choke point
      # for account creation, so a direct GraphQL call is blocked even if the landing UI is bypassed.
      # The admin / invite / project-shared / VC-screened paths do NOT go through this mutation and
      # are unaffected.
      unless AppConfigHelper.self_service_signup_enabled?
        raise GraphQL::ExecutionError, SIGNUP_DISABLED_MESSAGE
      end

      existing_user = User.find_by(email: email)
      if existing_user
        raise GraphQL::ExecutionError, "Email has already been taken"
      end

      begin
        @user = UserFactoryService.call(
          email: email,
          role: User::ROLE_REGULAR_USER,
          send_activation: true,
          signup_path: User::SIGNUP_PATH[:self_registered]
        )
      rescue Auth0::Unsupported => e
        # Auth0 returns 409 when the email already exists in the tenant (present in Auth0 but not the
        # local DB). Surface the same graceful "already taken" GraphQL error as the local-dup case
        # above, rather than letting it bubble to GraphqlController#execute as an unhandled 500. (#384)
        raise e unless e.message.to_s.match?(/already exists/i)

        raise GraphQL::ExecutionError, "Email has already been taken"
      end
    else
      raise GraphQL::ExecutionError, "Permission denied"
    end
  end
end

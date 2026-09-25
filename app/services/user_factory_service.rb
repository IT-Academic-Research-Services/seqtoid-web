class UserFactoryService
  include Callable
  attr_accessor :auth0_user_id, :current_user, :new_user, :new_user_params,
                :project_id, :send_activation, :signup_path

  def initialize(
    email:,
    name: nil,
    current_user: nil,
    project_id: nil,
    send_activation: false,
    signup_path: nil,
    created_by_user_id: nil,
    **other_user_attrs
  )
    @project_id = project_id
    @send_activation = send_activation
    @signup_path = signup_path
    @new_user_params = {
      email: email.downcase,
      name: name,
      created_by_user_id: created_by_user_id,
      **other_user_attrs,
    }
    @current_user = current_user
  end

  def call
    ActiveRecord::Base.transaction do
      @new_user = User.create!(**new_user_params)
      create_auth0_user_and_save_user_id
    end

    record_new_user_in_airtable
    send_activation_email if send_activation

    new_user
  rescue ActiveRecord::RecordInvalid => err
    LogUtil.log_error(
      "Failed to create user: #{err.message}",
      exception: err,
      user_params: new_user_params
    )
    # re-raise error for awareness to callers
    raise
  end

  private

  def record_new_user_in_airtable
    table_name = "CZ ID Accounts"
    data = {
      fields: {
        userId: new_user.id,
        signupPath: signup_path,
      },
    }
    MetricUtil.post_to_airtable(table_name, data.to_json)
  rescue StandardError => err
    LogUtil.log_error(
      "Error when recording new user in AirTable",
      exception: err,
      table_name: table_name,
      data: data
    )
  end

  def create_auth0_user_and_save_user_id
    auth0_response = Auth0UserManagementHelper.create_auth0_user(**new_user.slice(:email, :name, :role).symbolize_keys)
    @auth0_user_id = auth0_response["user_id"]
  rescue StandardError => err
    LogUtil.log_error(
      "Error when creating user in Auth0",
      exception: err,
      user_params: new_user.slice(:email, :name, :role)
    )
    raise
  end

  # Account activation ("set your password").
  #
  # A new account with no project -- a screened sign-up -- is activated by AUTH0's own change-password
  # email rather than by our mailer:
  #   - Auth0 sends it from the tenant's email provider, so activation does not depend on this
  #     environment's outbound mail setup; and
  #   - it survives institutional mail scanners, which open every link in an inbound message to inspect
  #     it. The change-password link only loads a form and is consumed when a password is SUBMITTED, so a
  #     scanner's visit cannot spend it. (Auth0's one-click "verify your email" link is consumed by the
  #     visit itself, which is why create_auth0_user switches that email off.)
  # Verified on env-prod 2026-09-24: a ucsf.edu user set a password through this exact email.
  #
  # The project-invite path keeps its own UserMailer template because that email names the inviter and
  # the project, which Auth0's generic template cannot carry.
  def send_activation_email
    return send_auth0_activation_email if project_id.nil?

    reset_response = Auth0UserManagementHelper.get_auth0_password_reset_token(auth0_user_id)
    reset_url = reset_response["ticket"]

    UserMailer.new_auth0_user_new_project(
      current_user,
      new_user.email,
      project_id,
      reset_url
    ).deliver_now
  rescue Net::SMTPAuthenticationError => err
    LogUtil.log_error(
      "Error when sending account notification email to user.",
      exception: err,
      user_email: new_user.email
    )
    # re-raise error for awareness to callers
    raise
  end

  def send_auth0_activation_email
    Auth0UserManagementHelper.send_auth0_password_reset_email(new_user.email)
  rescue StandardError => err
    # The account already exists at this point. Re-raising would not help: a retry of the provisioning job
    # finds the existing user and stops, so the email would never be resent -- and it would skip the rest
    # of provisioning. Alert instead and let provisioning finish; the user can still request a password
    # email from the login page, and the alert tells us to follow up. Log the user id, not the address.
    LogUtil.log_error(
      "Auth0 activation email failed for new user",
      exception: err,
      user_id: new_user.id
    )
  end
end

# frozen_string_literal: true

# Option A: acts on a screening decision the standalone service posts back to the web app. APPROVED (auto
# or, later, a manual clear) provisions the account exactly as the normal signup would -- the DB user, the
# Auth0 user, and the activation ("set your password") email -- via the existing UserFactoryService.
# DENIED sends the "unable to accept" email. Idempotent: a duplicate/replayed callback for an
# already-provisioned email is a no-op, so at-least-once callback delivery never double-creates.
class ProvisionScreenedAccountJob
  extend InstrumentedJob

  @queue = :provision_screened_account

  # users.institution is VARCHAR(100), while the signup form accepts up to 200 characters. Truncate rather
  # than fail: an over-long value would raise at insert (MySQL strict mode) and leave an APPROVED applicant
  # with no account. The full value is still in the applicant's screening record.
  USER_INSTITUTION_MAX_LENGTH = 100

  def self.enqueue(payload)
    Resque.enqueue(self, payload)
  end

  def self.perform(payload)
    new.run(payload)
  end

  def run(payload)
    account = payload['account'] || {}
    case payload['decision']
    when 'approved' then provision(account, payload['correlation_id'])
    when 'denied'   then deny(account)
    else
      Rails.logger.warn("[ProvisionScreenedAccountJob] unknown decision #{payload['decision'].inspect} for #{payload['correlation_id']}")
    end
  end

  private

  def provision(account, correlation_id)
    email = account['email'].to_s.downcase
    return if email.blank?

    if User.exists?(email: email)
      Rails.logger.info("[ProvisionScreenedAccountJob] #{correlation_id} already provisioned (#{email}) -- no-op")
      return
    end

    user = UserFactoryService.new(
      email: email,
      name: account['name'],
      # The applicant gave their institution on the signup form and it rides through screening in the
      # account payload, but it was dropped here, so every screened account was created with none.
      institution: institution_for(account),
      # Set explicitly, as admin-created accounts are. The model allows a nil role (and nil is not an
      # admin), but a blank role on a real user is an odd state to leave behind.
      role: User::ROLE_REGULAR_USER,
      send_activation: true
    ).call

    # SMP-1901: if this applicant asked to transfer their CZ ID data on the (accountless) signup form, copy
    # that request from the local sidecar onto the now-provisioned user, then delete the row. A missing row
    # is normal (they did not use the signup form, or it was already claimed) and must never fail
    # provisioning -- the account and activation email above have already succeeded.
    apply_czid_transfer_request(user)
  rescue ActiveRecord::RecordInvalid => e
    # SMP-1902 -- the account failed model validation (e.g. a blocked personal/temporary email domain that
    # was not caught at the signup form: an admin/older screened request, or the flag flipped on after
    # submit). A validation failure is DETERMINISTIC, so a Resque retry would fail identically and leave the
    # applicant in limbo with no email. Treat it as a denial: send the decision email and stop, do not
    # re-raise. The generic error is logged (never shown to anyone) and never names which list matched.
    Rails.logger.warn(
      "[ProvisionScreenedAccountJob] #{correlation_id} provisioning rejected -- denying " \
      "(#{e.record&.errors&.full_messages&.to_sentence})"
    )
    deny(account)
  end

  def deny(account)
    email = account['email'].to_s
    return if email.blank?

    # A denied applicant is sent NOTHING by default (AppConfig::SEND_SIGNUP_DENIAL_EMAIL, off unless "1").
    if send_denial_email?
      send_denial_email(email)
    else
      Rails.logger.info("[ProvisionScreenedAccountJob] denial recorded; no email sent (denial email disabled)")
    end
    # SMP-1901: a denied applicant never becomes a user, so drop any CZ ID transfer request they left.
    delete_czid_transfer_request(email)
  end

  def send_denial_email?
    AppConfigHelper.get_app_config(AppConfig::SEND_SIGNUP_DENIAL_EMAIL) == "1"
  end

  # Used only when the denial email is switched on. deliver_now! (bang), so a failed send RAISES: the plain
  # deliver_now honours config.action_mailer.raise_delivery_errors, which is false in the deployed
  # environments, so a rejected send simply vanished -- no log line, no Sentry event, no failed job. (In
  # env-prod every denial email was lost that way: the environment had no verified sender.) Report it, then
  # re-raise so the job lands in the Resque failure queue and can be retried once mail works. Nothing has
  # been written for a denied applicant at this point, so a retry cannot provision anything.
  def send_denial_email(email)
    UserMailer.account_creation_denied(email).deliver_now!
  rescue StandardError => e
    ExportControl::ScreeningAudit.report_failure("signup.denial_email_failed", error: e)
    raise
  end

  def institution_for(account)
    account['institution'].to_s.strip.presence&.slice(0, USER_INSTITUTION_MAX_LENGTH)
  end

  # Copy the local CZ ID transfer request onto the freshly provisioned user, then delete the sidecar row.
  # Its own rescue: a failure here must never break account creation (which already happened) -- worst case
  # the row is left for the 90-day backstop purge and the user keeps the column defaults.
  def apply_czid_transfer_request(user)
    return if user.blank?

    row = CzidTransferRequest.find_by(email: CzidTransferRequest.normalize_email(user.email))
    return if row.nil?

    user.update!(
      wants_czid_data_transferred: row.wants_czid_data_transferred,
      czid_account_email: row.czid_account_email
    )
    row.destroy!
  rescue StandardError => e
    Rails.logger.error("[ProvisionScreenedAccountJob] czid-transfer copy failed for user #{user&.id}: #{e.class}")
  end

  def delete_czid_transfer_request(email)
    CzidTransferRequest.where(email: CzidTransferRequest.normalize_email(email)).delete_all
  rescue StandardError => e
    Rails.logger.error("[ProvisionScreenedAccountJob] czid-transfer delete-on-deny failed: #{e.class}")
  end
end

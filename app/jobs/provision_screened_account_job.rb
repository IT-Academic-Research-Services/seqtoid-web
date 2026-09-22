# frozen_string_literal: true

# Option A: acts on a screening decision the standalone service posts back to the web app. APPROVED (auto
# or, later, a manual clear) provisions the account exactly as the normal signup would -- the DB user, the
# Auth0 user, and the activation ("set your password") email -- via the existing UserFactoryService.
# DENIED sends the "unable to accept" email. Idempotent: a duplicate/replayed callback for an
# already-provisioned email is a no-op, so at-least-once callback delivery never double-creates.
class ProvisionScreenedAccountJob
  extend InstrumentedJob

  @queue = :provision_screened_account

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
      send_activation: true
    ).call

    # SMP-1901: if this applicant asked to transfer their CZ ID data on the (accountless) signup form, copy
    # that request from the local sidecar onto the now-provisioned user, then delete the row. A missing row
    # is normal (they did not use the signup form, or it was already claimed) and must never fail
    # provisioning -- the account and activation email above have already succeeded.
    apply_czid_transfer_request(user)
  end

  def deny(account)
    email = account['email'].to_s
    return if email.blank?

    UserMailer.account_creation_denied(email).deliver_now
    # SMP-1901: a denied applicant never becomes a user, so drop any CZ ID transfer request they left.
    delete_czid_transfer_request(email)
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

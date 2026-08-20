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

    UserFactoryService.new(
      email: email,
      name: account['name'],
      send_activation: true
    ).call
  end

  def deny(account)
    email = account['email'].to_s
    return if email.blank?

    UserMailer.account_creation_denied(email).deliver_now
  end
end

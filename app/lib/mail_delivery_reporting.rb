# frozen_string_literal: true

# Makes a failed outbound email visible.
#
# WHY: the deployed environments set config.action_mailer.raise_delivery_errors = false, so when SES rejects a
# send (for example "Email address is not verified" while the account is in the SES sandbox) Mail swallows the
# error: no log line, no Sentry event, no failed job. In env-prod every applicant notice (existing-account,
# signup denial, compliance hold alert) was lost that way and nobody could tell.
#
# HOW: prepended onto the :ses_v2 delivery method (Aws::ActionMailer::SESV2::Mailer, see
# config/initializers/mail_delivery_reporting.rb). A failed send is logged with the "[mail_delivery_failed]"
# marker and reported to Sentry, then RE-RAISED unchanged, so behavior is exactly as before:
#   - raise_delivery_errors = false (deployed envs): Mail still swallows it; the user path is not broken.
#   - deliver_now! / raise_delivery_errors = true: the caller still gets the exception.
#
# PRIVACY: never logs a recipient address or the provider's error text (SES puts the address in it). Only the
# error class, the SES error code, the recipient count and the recipient domains are recorded.
module MailDeliveryReporting
  LOG_MARKER = "[mail_delivery_failed]"

  def deliver!(message)
    super
  rescue StandardError => e
    MailDeliveryReporting.report(message, e)
    raise
  end

  def self.report(message, error)
    LogUtil.log_message(
      "#{LOG_MARKER} outbound email was not delivered",
      level: :error,
      **details(message, error)
    )
  rescue StandardError
    # Reporting must never replace the original delivery error.
    nil
  end

  def self.details(message, error)
    recipients = Array(message.to) + Array(message.cc) + Array(message.bcc)
    {
      error_class: error.class.name,
      ses_error_code: error.respond_to?(:code) ? error.code.to_s : nil,
      recipient_count: recipients.size,
      recipient_domains: recipients.filter_map { |addr| addr.to_s.split("@", 2)[1]&.downcase }.uniq.sort.join(","),
    }
  end
end

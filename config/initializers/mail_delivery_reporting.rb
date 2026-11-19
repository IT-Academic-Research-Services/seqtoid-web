# frozen_string_literal: true

# Report failed :ses_v2 sends instead of dropping them silently. See app/lib/mail_delivery_reporting.rb.
Rails.application.config.to_prepare do
  mailer = Aws::ActionMailer::SESV2::Mailer
  mailer.prepend(MailDeliveryReporting) unless mailer.ancestors.include?(MailDeliveryReporting)
end

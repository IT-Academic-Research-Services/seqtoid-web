class ApplicationMailer < ActionMailer::Base
  # From is env-driven: SES can only send from a VERIFIED identity, and seqtoid-support@ucsf.edu
  # (the old default) is a UCSF mailbox SES cannot send *from*. Configured envs set
  # MAIL_FROM_ADDRESS to the verified SES sender (e.g. "SeqToID <no-reply@dev.seqtoid.org>");
  # the literal fallback preserves prior behavior where it is unset. Evaluated per-send via the
  # proc so a test or a late-bound chamber var is picked up.
  default from: -> { ENV["MAIL_FROM_ADDRESS"].presence || 'The SeqtoID Team <seqtoid-support@ucsf.edu>' }
  layout 'mailer'
  # Mailer templates cannot reach UserContext; expose help_center_host to them.
  helper HelpCenterHelper
end

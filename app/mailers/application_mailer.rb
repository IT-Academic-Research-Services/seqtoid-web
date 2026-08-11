class ApplicationMailer < ActionMailer::Base
  default from: 'The SeqtoID Team <seqtoid-support@ucsf.edu>'
  layout 'mailer'
  # Mailer templates cannot reach UserContext; expose help_center_host to them.
  helper HelpCenterHelper
end

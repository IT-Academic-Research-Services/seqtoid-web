class ApplicationMailer < ActionMailer::Base
  default from: 'The CZ ID Team <help@czid.org>'
  layout 'mailer'
  # Mailer templates cannot reach UserContext; expose help_center_host to them.
  helper HelpCenterHelper
end

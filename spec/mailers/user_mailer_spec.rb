require "rails_helper"

# Specs for UserMailer. Exercises every mailer action plus the error-handling
# branch of added_to_projects_email. See app/mailers/user_mailer.rb.
RSpec.describe UserMailer, type: :mailer do
  describe "#added_to_projects_email" do
    it "builds an invitation email addressed to the new user" do
      sharing_user = create(:user)
      new_user = create(:user)
      project = create(:project, users: [sharing_user])

      mail = described_class.added_to_projects_email(
        new_user.id,
        email_subject: "You have been added to a project on CZ ID",
        sharing_user_id: sharing_user.id,
        shared_project_id: project.id
      )

      expect(mail.to).to eq([new_user.email])
      expect(mail.subject).to eq("You have been added to a project on CZ ID")
      expect(mail.body.encoded).to include(project.name)
      expect(mail.body.encoded).to include(sharing_user.name)
    end

    # Characterization: the rescue block references bare identifiers
    # (new_user_email, sharing_user, shared_project_name, shared_project_id)
    # instead of the @-prefixed instance variables. Because LogUtil.log_error
    # captures those as keyword args (**details), the bare names are evaluated
    # as method calls and raise NameError inside the rescue. So when the mail
    # build fails (here: a missing user), the rescue itself raises NameError
    # rather than logging cleanly. This pins CURRENT behavior; see report.
    context "when the mail build fails (bug in rescue block)" do
      it "raises NameError from the rescue clause instead of logging cleanly" do
        # ActionMailer builds the message lazily, so force materialization
        # with .message to actually run the mailer method body.
        expect do
          described_class.added_to_projects_email(
            -1, # non-existent user id -> User.find raises RecordNotFound
            email_subject: "subject",
            sharing_user_id: -1,
            shared_project_id: -1
          ).message
        end.to raise_error(NameError)
      end
    end
  end

  describe "#landing_sign_up_email" do
    it "sends to the help address with the provided body" do
      mail = described_class.landing_sign_up_email("Please make me an account")

      expect(mail.to).to eq(["seqtoid-support@ucsf.edu"])
      expect(mail.subject).to eq("New sign up from landing page")
      expect(mail.body.encoded).to include("Please make me an account")
    end
  end

  describe "#account_request_reply" do
    it "replies to the requesting email" do
      mail = described_class.account_request_reply("requester@example.com")

      expect(mail.to).to eq(["requester@example.com"])
      expect(mail.subject).to eq("Thank you for contacting The SeqtoID Team")
    end
  end

  describe "#new_auth0_user_new_project" do
    it "invites the new user and references the shared project" do
      sharing_user = create(:user, name: "Sharer", email: "sharer@example.com")
      project = create(:project, users: [sharing_user])

      mail = described_class.new_auth0_user_new_project(
        sharing_user,
        "invitee@example.com",
        project.id,
        "https://example.com/reset"
      )

      expect(mail.to).to eq(["invitee@example.com"])
      expect(mail.subject).to eq("You have been invited to CZ ID")
      expect(mail.body.encoded).to include("https://example.com/reset")
    end
  end

  describe "#account_activation" do
    it "sends an activation email with the reset password url" do
      mail = described_class.account_activation("new@example.com", "https://example.com/activate")

      expect(mail.to).to eq(["new@example.com"])
      expect(mail.subject).to eq("You have been invited to CZ ID")
      expect(mail.body.encoded).to include("https://example.com/activate")
    end
  end

  describe "#no_account_found" do
    it "notifies the email that no account was found" do
      mail = described_class.no_account_found("unknown@example.com")

      expect(mail.to).to eq(["unknown@example.com"])
      expect(mail.subject).to eq("CZ ID | Could not locate an account with this email")
    end
  end
end

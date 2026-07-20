require "rails_helper"

# Coverage branch sweep for TokenCreationService. The main spec exercises the happy
# path (user_id, project claims, service_identity, expiration) against the real
# token_auth.py, which always succeeds -- so the `unless status.success?` FAILURE arm
# of generate_token is never taken. This pins it by stubbing Open3.capture3 to return
# a non-zero status; the test FAILS if that guard is inverted or removed (a healthy
# status would fall through to JSON.parse("") and raise a JSON::ParserError instead,
# and LogUtil.log_error would not be called).
RSpec.describe TokenCreationService, type: :service do
  create_users

  describe "#call when the token_auth script exits non-zero" do
    it "logs a TokenCreationError and raises it (the `unless status.success?` arm)" do
      failing_status = instance_double(Process::Status, success?: false)
      allow(Open3).to receive(:capture3).and_return(["", "token_auth.py failed", failing_status])

      expect(LogUtil).to receive(:log_error)
        .with(an_instance_of(IdentityController::TokenCreationError))

      expect do
        TokenCreationService.call(user_id: @joe.id)
      end.to raise_error(IdentityController::TokenCreationError)
    end
  end
end

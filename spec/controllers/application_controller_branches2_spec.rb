# frozen_string_literal: true

require "rails_helper"

# Coverage Wave (branch): residual branch for ApplicationController, complementing
# application_controller_branches_spec.rb. That file drives
# set_current_context_for_logging! with a request always present; the
# `_current_request = request if request` ELSE arm (no request object -- e.g. a
# controller invoked outside a request cycle, such as from a rake task or job)
# is never taken.
RSpec.describe ApplicationController, type: :controller do
  subject(:controller_instance) { described_class.new }

  let(:regular_user) { build_stubbed(:user, role: 0) }

  describe "#set_current_context_for_logging! with no request" do
    before do
      ApplicationRecord._current_user = nil
      ApplicationRecord._current_request = nil
    end

    after do
      ApplicationRecord._current_user = nil
      ApplicationRecord._current_request = nil
    end

    it "records the user but leaves the request unset (the request else-arm)" do
      allow(controller_instance).to receive(:current_user).and_return(regular_user)
      allow(controller_instance).to receive(:request).and_return(nil)

      controller_instance.send(:set_current_context_for_logging!)

      expect(Thread.current[:_current_user]).to eq(regular_user)
      expect(Thread.current[:_current_request]).to be_nil
    end

    it "leaves both unset when there is neither a user nor a request (both else-arms)" do
      allow(controller_instance).to receive(:current_user).and_return(nil)
      allow(controller_instance).to receive(:request).and_return(nil)

      controller_instance.send(:set_current_context_for_logging!)

      expect(Thread.current[:_current_user]).to be_nil
      expect(Thread.current[:_current_request]).to be_nil
    end
  end
end

require 'rails_helper'

# Branch-coverage spec for BasespaceController#oauth.
#
# The existing basespace_controller_spec.rb covers the happy token exchange and the
# no-code short-circuit, but never the rescue arm around the token POST. This drives
# HttpHelper.post_json to raise so the rescue records the error and leaves
# @access_token nil instead of propagating.
#
# TEST-ONLY. Mutation-checked.
RSpec.describe BasespaceController, type: :controller do
  create_users

  before { sign_in @joe }

  describe "GET #oauth token-exchange failure (rescue arm)" do
    before do
      stub_const('ENV', ENV.to_hash.merge(
        "CZID_BASESPACE_OAUTH_REDIRECT_URI" => "MOCK_URI",
        "CZID_BASESPACE_CLIENT_ID" => "MOCK_ID",
        "CZID_BASESPACE_CLIENT_SECRET" => "MOCK_SECRET"
      ))
      allow(HttpHelper).to receive(:post_json).and_raise(StandardError, "network down")
    end

    it "logs the failure and leaves the access token nil without raising" do
      expect(LogUtil).to receive(:log_error)
        .with(a_string_including("Failed to get basespace access token"), any_args)

      get :oauth, params: { code: "MOCK_CODE" }

      # If the rescue were removed, the raise would propagate rather than rendering.
      expect(response).to render_template("oauth")
      expect(assigns(:access_token)).to be_nil
    end
  end
end

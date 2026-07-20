require 'rails_helper'

# Branch-coverage spec for HomeController.
#
# The existing home_controller_spec.rb / home_request_spec.rb cover the landing
# render, index my_data/owns/public redirects, sanitized_project_id, admin_required
# gates, sign_up 406/success, taxon_descriptions, feedback and maintenance-redirect.
# This targets the arms they never reach:
#   * index: the admin -> all_data arm and the final else -> my_data arm
#   * landing: the three banner "== 1" arms
#   * page_not_found: signed-in vs anonymous
#   * maintenance: the disabled_for_maintenance? true arm
#   * sign_up: the inner mailer rescue and the outer rescue -> 500
#   * set_app_config: the default-alignment-config arm and the rescue arm
#   * set_workflow_version: success, the check-failed raise, and the AccessDenied rescue
#
# TEST-ONLY. Mutation-checked.
RSpec.describe HomeController, type: :controller do
  create_users

  describe "GET #index remaining redirect arms" do
    it "redirects an admin to all_data for a private project they do not own" do
      sign_in @admin
      project = create(:project, users: [@joe]) # private, not owned by admin
      get :index, params: { project_id: project.id }
      expect(response).to redirect_to(action: "all_data", project_id: project.id.to_s)
    end

    it "redirects a non-admin to my_data for a private project they do not own (final else)" do
      sign_in @joe
      project = create(:project, users: [@admin]) # private, not owned by joe
      get :index, params: { project_id: project.id }
      expect(response).to redirect_to(my_data_path)
    end
  end

  describe "GET #landing banner arms" do
    it "enables all three banners when their app configs are set to '1'" do
      # get_app_config returns '1' for every banner key -> each `== \"1\"` arm fires.
      allow(controller).to receive(:get_app_config).and_return("1")

      get :landing, params: { format: "html" }

      expect(assigns(:show_bulletin)).to be(true)
      expect(assigns(:show_announcement_banner)).to be(true)
      expect(assigns(:show_public_site)).to be(true)
    end
  end

  describe "GET #page_not_found" do
    it "shows the marketing header for an anonymous visitor" do
      get :page_not_found
      expect(assigns(:show_landing_header)).to be(true)
    end

    it "hides the marketing header for a signed-in user" do
      sign_in @joe
      get :page_not_found
      expect(assigns(:show_landing_header)).to be(false)
    end
  end

  describe "GET #maintenance when the site IS disabled" do
    it "renders the maintenance page instead of redirecting" do
      sign_in @joe
      allow(controller).to receive(:disabled_for_maintenance?).and_return(true)

      get :maintenance

      expect(response).not_to have_http_status(:redirect)
      expect(assigns(:show_blank_header)).to be(true)
    end
  end

  describe "POST #sign_up rescue arms" do
    let(:sign_up_params) do
      {
        firstName: "Joe", lastName: "Schmoe", email: "fake@czid.org",
        institution: "Fake Institution", usage: "metagenomics",
      }
    end

    before do
      allow(MetricUtil).to receive(:log_analytics_event)
      allow(MetricUtil).to receive(:post_to_airtable)
    end

    it "swallows a failure of the account-request reply email and still succeeds" do
      allow(UserMailer).to receive(:account_request_reply).and_raise(StandardError, "smtp down")
      allow(UserMailer).to receive(:landing_sign_up_email).and_return(double(deliver_now: true))
      expect(LogUtil).to receive(:log_error).with(a_string_including("account_request_reply"), any_args)

      post :sign_up, params: { signUp: sign_up_params }

      # Inner rescue only logs; the request still completes with an ok payload.
      expect(JSON.parse(response.body)["status"]).to eq("ok")
    end

    it "returns an internal_server_error payload when the outer flow raises" do
      allow(UserMailer).to receive(:account_request_reply).and_return(double(deliver_now: true))
      allow(UserMailer).to receive(:landing_sign_up_email).and_raise(StandardError, "boom")

      post :sign_up, params: { signUp: sign_up_params }

      # render json: { status: :internal_server_error } (no HTTP status arg) => 200 body.
      expect(JSON.parse(response.body)["status"]).to eq("internal_server_error")
    end
  end

  describe "PUT #set_app_config arms (admin)" do
    before { sign_in @admin }

    it "routes the default-alignment-config key to update_default_alignment_config" do
      expect(AppConfigHelper).to receive(:update_default_alignment_config).with("some_value")
      expect(AppConfigHelper).not_to receive(:set_app_config)

      put :set_app_config, params: { key: AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME, value: "some_value" }

      expect(JSON.parse(response.body)["status"]).to eq("success")
    end

    it "renders (does not raise) when the config write fails (rescue arm)" do
      allow(AppConfigHelper).to receive(:set_app_config).and_raise(StandardError, "kaboom")

      expect do
        put :set_app_config, params: { key: "some_flag", value: "1" }
      end.not_to raise_error
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["status"]).not_to eq("success")
    end
  end

  describe "PUT #set_workflow_version arms (admin)" do
    before { sign_in @admin }

    it "reports success when the wdl exists and the version is set" do
      allow_any_instance_of(HomeController).to receive(:check_valid_workflow).and_return(true)
      expect(AppConfigHelper).to receive(:set_workflow_version).with("short-read-mngs", "1.0.0")

      put :set_workflow_version, params: { key: "short-read-mngs-version", value: "1.0.0" }

      expect(JSON.parse(response.body)["status"]).to eq("success")
    end

    it "reports failure via the StandardError rescue when the wdl is missing" do
      # check_valid_workflow returns false -> the `|| raise(...)` fires -> generic rescue.
      allow_any_instance_of(HomeController).to receive(:check_valid_workflow).and_return(false)

      put :set_workflow_version, params: { key: "short-read-mngs-version", value: "9.9.9" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["status"]).not_to eq("success")
    end

    it "returns the not-found message via the AccessDenied rescue" do
      allow_any_instance_of(HomeController).to receive(:check_valid_workflow)
        .and_raise(Aws::S3::Errors::AccessDenied.new(nil, "Access Denied"))

      put :set_workflow_version, params: { key: "short-read-mngs-version", value: "1.0.0" }

      expect(JSON.parse(response.body)["status"]).to eq("Updating workflow failed could not find wdl file")
    end
  end
end

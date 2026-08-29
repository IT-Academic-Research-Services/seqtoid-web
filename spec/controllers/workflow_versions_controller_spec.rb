require "rails_helper"

# CZID-971 (step 5) -- the register-only catalog endpoint the workflow publisher calls.
RSpec.describe WorkflowVersionsController, type: :controller do
  let(:token) { "s3cr3t-publisher-token" }

  def authenticate!(value = token)
    request.headers["X-Workflow-Publisher-Token"] = value
  end

  around do |example|
    original = ENV["WORKFLOW_PUBLISHER_TOKEN"]
    ENV["WORKFLOW_PUBLISHER_TOKEN"] = token
    example.run
    ENV["WORKFLOW_PUBLISHER_TOKEN"] = original
  end

  describe "POST #create" do
    context "authentication" do
      it "rejects a request with no token" do
        post :create, params: { workflow: "consensus-genome", version: "3.5.5" }

        expect(response).to have_http_status(:unauthorized)
        expect(WorkflowVersion.exists?(workflow: "consensus-genome", version: "3.5.5")).to be false
      end

      it "rejects a request with the wrong token" do
        authenticate!("not-the-token")
        post :create, params: { workflow: "consensus-genome", version: "3.5.5" }

        expect(response).to have_http_status(:unauthorized)
        expect(WorkflowVersion.exists?(workflow: "consensus-genome", version: "3.5.5")).to be false
      end

      it "fails closed when no token is configured at all" do
        ENV["WORKFLOW_PUBLISHER_TOKEN"] = nil
        authenticate!

        post :create, params: { workflow: "consensus-genome", version: "3.5.5" }

        expect(response).to have_http_status(:unauthorized)
      end

      it "does not require a logged-in user" do
        authenticate!
        post :create, params: { workflow: "consensus-genome", version: "3.5.5" }

        expect(response).to have_http_status(:created)
      end
    end

    context "registration" do
      before { authenticate! }

      it "creates a runnable, non-deprecated catalog row" do
        post :create, params: { workflow: "consensus-genome", version: "3.5.5" }

        expect(response).to have_http_status(:created)
        entry = WorkflowVersion.find_by(workflow: "consensus-genome", version: "3.5.5")
        expect(entry).to be_present
        expect(entry.runnable).to be true
        expect(entry.deprecated).to be false
      end

      it "is idempotent -- re-registering succeeds without duplicating" do
        post :create, params: { workflow: "consensus-genome", version: "3.5.5" }
        post :create, params: { workflow: "consensus-genome", version: "3.5.5" }

        expect(response).to have_http_status(:ok)
        expect(WorkflowVersion.where(workflow: "consensus-genome", version: "3.5.5").count).to eq(1)
      end

      # The whole reason this endpoint exists rather than reusing home#set_workflow_version.
      it "REGISTERS ONLY -- it must not promote the version to the environment default" do
        key = format(AppConfig::WORKFLOW_VERSION_TEMPLATE, workflow_name: "consensus-genome")
        AppConfigHelper.set_app_config(key, "3.5.1")

        post :create, params: { workflow: "consensus-genome", version: "3.5.5" }

        expect(response).to have_http_status(:created)
        expect(AppConfigHelper.get_app_config(key)).to eq("3.5.1")
      end
    end

    context "validation" do
      before { authenticate! }

      it "rejects a non-semver version" do
        post :create, params: { workflow: "consensus-genome", version: "3.5" }

        expect(response).to have_http_status(:unprocessable_content)
        expect(WorkflowVersion.where(workflow: "consensus-genome").count).to eq(0)
      end

      it "rejects a malformed workflow name" do
        post :create, params: { workflow: "../etc/passwd", version: "1.0.0" }

        expect(response).to have_http_status(:unprocessable_content)
      end

      it "rejects a missing workflow" do
        post :create, params: { version: "1.0.0" }

        expect(response).to have_http_status(:unprocessable_content)
      end
    end
  end
end

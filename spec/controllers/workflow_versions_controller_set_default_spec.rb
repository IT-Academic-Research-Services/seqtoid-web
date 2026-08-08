require "rails_helper"

# The machine-callable DEFAULT flip (promote-to-staging's hands-off equivalent of the admin
# home#set_workflow_version). Token-authed (SEPARATE from the publisher token), no session.
RSpec.describe WorkflowVersionsController, type: :controller do
  let(:token) { "s3cr3t-promoter-token" }

  def authenticate!(value = token)
    request.headers["X-Workflow-Promoter-Token"] = value
  end

  around do |example|
    original = ENV["WORKFLOW_PROMOTER_TOKEN"]
    ENV["WORKFLOW_PROMOTER_TOKEN"] = token
    example.run
    ENV["WORKFLOW_PROMOTER_TOKEN"] = original
  end

  describe "PUT #set_default" do
    context "authentication" do
      it "rejects a request with no token" do
        expect(SetDefaultWorkflowVersionService).not_to receive(:call)
        put :set_default, params: { workflow: "short-read-mngs", version: "8.3.16" }
        expect(response).to have_http_status(:unauthorized)
      end

      it "rejects a request with the wrong token" do
        authenticate!("not-the-token")
        expect(SetDefaultWorkflowVersionService).not_to receive(:call)
        put :set_default, params: { workflow: "short-read-mngs", version: "8.3.16" }
        expect(response).to have_http_status(:unauthorized)
      end

      it "fails closed when no token is configured at all" do
        ENV["WORKFLOW_PROMOTER_TOKEN"] = nil
        authenticate!
        put :set_default, params: { workflow: "short-read-mngs", version: "8.3.16" }
        expect(response).to have_http_status(:unauthorized)
      end

      it "does NOT accept the publisher token (separate credential)" do
        authenticate!(ENV["WORKFLOW_PUBLISHER_TOKEN"].to_s)
        put :set_default, params: { workflow: "short-read-mngs", version: "8.3.16" }
        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "when authenticated" do
      before { authenticate! }

      it "flips the default and returns previous -> new" do
        result = SetDefaultWorkflowVersionService::Result.new(ok: true, previous: "8.3.15")
        expect(SetDefaultWorkflowVersionService).to receive(:call)
          .with(workflow: "short-read-mngs", version: "8.3.16").and_return(result)

        put :set_default, params: { workflow: "short-read-mngs", version: "8.3.16" }

        expect(response).to have_http_status(:ok)
        body = JSON.parse(response.body)
        expect(body).to include("status" => "ok", "workflow" => "short-read-mngs",
                                "previous_version" => "8.3.15", "version" => "8.3.16")
      end

      it "returns 422 when the bundle is missing (service not ok)" do
        result = SetDefaultWorkflowVersionService::Result.new(ok: false, previous: "8.3.15",
                                                              error: "wdl bundle for short-read-mngs-v8.3.16 not found")
        allow(SetDefaultWorkflowVersionService).to receive(:call).and_return(result)

        put :set_default, params: { workflow: "short-read-mngs", version: "8.3.16" }

        expect(response).to have_http_status(:unprocessable_entity)
        expect(JSON.parse(response.body)["error"]).to match(/not found/)
      end

      it "rejects an invalid version without calling the service" do
        expect(SetDefaultWorkflowVersionService).not_to receive(:call)
        put :set_default, params: { workflow: "short-read-mngs", version: "not-a-version" }
        expect(response).to have_http_status(:unprocessable_entity)
      end

      it "rejects an invalid workflow name without calling the service" do
        expect(SetDefaultWorkflowVersionService).not_to receive(:call)
        put :set_default, params: { workflow: "Bad Name!", version: "8.3.16" }
        expect(response).to have_http_status(:unprocessable_entity)
      end
    end
  end
end

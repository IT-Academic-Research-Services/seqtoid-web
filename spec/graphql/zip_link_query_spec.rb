require "rails_helper"

RSpec.describe GraphqlController, type: :request do
  create_users

  query = <<GQL
  query DownloadAllButtonQuery($workflowRunId: String) {
    ZipLink(workflowRunId: $workflowRunId) {
      error
      url
    }
  }
GQL

  context "Joe" do
    before { sign_in @joe }

    it "returns the zip link url for an accessible workflow run" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project, user: @joe)
      workflow_run = create(:workflow_run, sample: sample, user: @joe)
      allow(WorkflowRunZipService).to receive(:call).and_return("https://s3.example/results.zip")

      post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
        query: query,
        variables: { workflowRunId: workflow_run.id.to_s },
      }.to_json

      expect(response).to have_http_status(:success)
      data = JSON.parse(response.body).dig("data", "ZipLink")
      expect(data["url"]).to eq("https://s3.example/results.zip")
      expect(data["error"]).to be_nil
    end

    # CZID-307 parity: WorkflowRunsController#zip_link renders HTTP 404 when there is no output,
    # and the federation Ziplink resolver returns `res.statusText` ("Not Found") — not the JSON
    # body. Both the no-output and the not-accessible cases are 404s → "Not Found".
    it "returns Not Found when there is no zip link" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project, user: @joe)
      workflow_run = create(:workflow_run, sample: sample, user: @joe)
      allow(WorkflowRunZipService).to receive(:call).and_return(nil)

      post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
        query: query,
        variables: { workflowRunId: workflow_run.id.to_s },
      }.to_json

      expect(response).to have_http_status(:success)
      data = JSON.parse(response.body).dig("data", "ZipLink")
      expect(data["url"]).to be_nil
      expect(data["error"]).to eq("Not Found")
    end

    it "returns Not Found when the workflow run is not accessible" do
      post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
        query: query,
        variables: { workflowRunId: "0" },
      }.to_json

      expect(response).to have_http_status(:success)
      data = JSON.parse(response.body).dig("data", "ZipLink")
      expect(data["url"]).to be_nil
      expect(data["error"]).to eq("Not Found")
    end
  end
end

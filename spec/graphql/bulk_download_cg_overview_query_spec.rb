require "rails_helper"

RSpec.describe GraphqlController, type: :request do
  create_users

  query = <<GQL
  query BulkDownloadModalQuery($workflowRunIdsStrings: [String], $includeMetadata: Boolean!, $downloadType: String!, $workflow: String!, $authenticityToken: String!) {
    BulkDownloadCGOverview(input: {workflowRunIdsStrings: $workflowRunIdsStrings, includeMetadata: $includeMetadata, downloadType: $downloadType, workflow: $workflow, authenticityToken: $authenticityToken}) {
      cgOverviewRows
    }
  }
GQL

  context "Admin" do
    before { sign_in @admin }

    # CZID-307 parity: exercise the REAL validate_bulk_download_create_params chain — which calls
    # get_app_config via AppConfigHelper — instead of stubbing it. The previous spec stubbed that
    # method, hiding a `NoMethodError: undefined method get_app_config for Types::QueryType` that
    # the federation-vs-Rails parity diff caught (AppConfigHelper wasn't included). Only
    # generate_cg_overview_data (which reads workflow outputs from S3) is stubbed here.
    it "returns the CG overview rows for viewable workflow runs" do
      AppConfig.find_or_initialize_by(key: AppConfig::MAX_OBJECTS_BULK_DOWNLOAD).update!(value: "100")
      project = create(:project, users: [@admin])
      sample = create(:sample, project: project, user: @admin)
      wr1 = create(:workflow_run, sample: sample, user: @admin, workflow: WorkflowRun::WORKFLOW[:consensus_genome])
      wr2 = create(:workflow_run, sample: sample, user: @admin, workflow: WorkflowRun::WORKFLOW[:consensus_genome])

      rows = [["Sample Name", "Coverage Depth"], ["sampleA", "100"]]
      allow(BulkDownloadsHelper).to receive(:generate_cg_overview_data).and_return(rows)

      post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
        query: query,
        variables: {
          workflowRunIdsStrings: [wr1.id.to_s, wr2.id.to_s],
          includeMetadata: false,
          downloadType: "consensus_genome_intermediate_output_files",
          workflow: "consensus-genome",
          authenticityToken: "t",
        },
      }.to_json

      expect(response).to have_http_status(:success)
      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")
      data = parsed.dig("data", "BulkDownloadCGOverview")
      expect(data["cgOverviewRows"]).to eq(rows)
    end
  end
end

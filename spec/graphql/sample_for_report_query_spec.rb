require "rails_helper"

# CZID-310: native Rails GraphQL port of the federation SampleForReport read op (missed in
# 303; needed for the SampleView report page + the 305 cutover). Mirrors
# SamplesController#show + the federation id-stringification.
RSpec.describe GraphqlController, type: :request do
  create_users

  SAMPLE_FOR_REPORT_QUERY = <<GQL
  query SampleViewSampleQuery($railsSampleId: String, $snapshotLinkId: String) {
    SampleForReport(railsSampleId: $railsSampleId, snapshotLinkId: $snapshotLinkId) {
      id
      railsSampleId
      name
      created_at
      project_id
      status
      user_id
      initial_workflow
      default_pipeline_run_id
      editable
      project {
        id
        name
        pinned_alignment_config
      }
      pipeline_runs {
        id
        pipeline_version
        alignment_config_name
        run_finalized
      }
      workflow_runs {
        id
        workflow
        deprecated
        run_finalized
      }
    }
  }
GQL

  context "Joe" do
    before { sign_in @joe }

    it "maps the sample report tree and stringifies ids" do
      project = create(:project, users: [@joe], name: "Proj A")
      sample = create(:sample, project: project, user: @joe, name: "Sample A")
      pr = create(:pipeline_run, sample: sample, pipeline_version: "8.0")
      wr = create(:workflow_run, sample: sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:consensus_genome])
      # default_background_id derives from the host genome / a "Human" background that the
      # bare factory sample lacks; stub it (it's not what this port test is exercising).
      allow_any_instance_of(Sample).to receive(:default_background_id).and_return(26)

      post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
        query: SAMPLE_FOR_REPORT_QUERY,
        variables: { railsSampleId: sample.id.to_s, snapshotLinkId: nil },
      }.to_json

      expect(response).to have_http_status(:success)
      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")

      data = parsed.dig("data", "SampleForReport")
      expect(data).to include(
        "id" => sample.id.to_s,           # = railsSampleId arg
        "railsSampleId" => sample.id.to_s,
        "name" => "Sample A",
        "project_id" => project.id,
        "user_id" => @joe.id,
        "editable" => true
      )
      # first pipeline run id, stringified
      expect(data["default_pipeline_run_id"]).to eq(pr.id.to_s)

      # project: id stringified (the federation post-processing)
      expect(data["project"]).to eq(
        "id" => project.id.to_s, "name" => "Proj A",
        "pinned_alignment_config" => project.pinned_alignment_config
      )

      # pipeline_runs[].id + workflow_runs[].id stringified
      expect(data["pipeline_runs"].map { |p| p["id"] }).to eq([pr.id.to_s])
      expect(data.dig("pipeline_runs", 0, "pipeline_version")).to eq("8.0")
      expect(data["workflow_runs"].map { |w| w["id"] }).to eq([wr.id.to_s])
      expect(data.dig("workflow_runs", 0, "workflow")).to eq(WorkflowRun::WORKFLOW[:consensus_genome])
    end
  end
end

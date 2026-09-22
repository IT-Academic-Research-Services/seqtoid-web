require "rails_helper"

# CZID-304: native Rails GraphQL port of the federation KickoffWGSWorkflow mutation.
# Mirrors SamplesController#kickoff_workflow. The dispatch (create_and_dispatch_workflow_run,
# which submits to Step Functions) and workflow_runs_info are stubbed so the spec never
# dispatches real compute.
RSpec.describe GraphqlController, type: :request do
  create_users

  KICKOFF_WGS_MUTATION = <<GQL
  mutation ConsensusGenomeCreationModalMutation($sampleId: String!, $input: mutationInput_KickoffWGSWorkflow_input_Input) {
    KickoffWGSWorkflow(sampleId: $sampleId, input: $input) {
      id
      status
      workflow
      deprecated
      executed_at
      input_error
      run_finalized
      wdl_version
      parsed_cached_results {
        quality_metrics {
          total_reads
          qc_percent
        }
      }
      inputs {
        accession_id
        accession_name
        taxon_id
        taxon_name
        technology
        card_version
        wildcard_version
      }
    }
  }
GQL

  context "Joe" do
    before { sign_in @joe }

    it "dispatches a workflow run and returns workflow_runs_info with stringified ids" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project, user: @joe)

      captured = nil
      allow_any_instance_of(Sample).to receive(:create_and_dispatch_workflow_run) do |_sample, workflow, user_id, inputs_json:|
        captured = { workflow: workflow, user_id: user_id, inputs_json: inputs_json }
      end
      allow_any_instance_of(Sample).to receive(:workflow_runs_info).and_return([
        {
          "id" => 42, "status" => "RUNNING", "workflow" => "consensus_genome", "wdl_version" => "1.0",
          "executed_at" => "2026-01-01T00:00:00Z", "deprecated" => false, "input_error" => nil,
          "inputs" => { "accession_id" => "KX1", "accession_name" => "Virus", "technology" => "Illumina" },
          "parsed_cached_results" => { "quality_metrics" => { "total_reads" => 100, "qc_percent" => 99.0 } },
          "run_finalized" => false,
        },
      ])

      post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
        query: KICKOFF_WGS_MUTATION,
        variables: {
          sampleId: sample.id.to_s,
          input: {
            workflow: "consensus_genome",
            inputs_json: { accession_id: "KX1", accession_name: "Virus", technology: "Illumina" },
            authenticityToken: "t",
          },
        },
      }.to_json

      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")

      # dispatched with the right workflow + user + JSON-serialized inputs
      expect(captured[:workflow]).to eq("consensus_genome")
      expect(captured[:user_id]).to eq(@joe.id)
      expect(JSON.parse(captured[:inputs_json])).to include("accession_id" => "KX1", "technology" => "Illumina")

      data = parsed.dig("data", "KickoffWGSWorkflow")
      expect(data.length).to eq(1)
      item = data.first
      expect(item["id"]).to eq("42") # stringified
      expect(item["status"]).to eq("RUNNING")
      expect(item["run_finalized"]).to eq(false)
      expect(item.dig("inputs", "accession_id")).to eq("KX1")
      expect(item.dig("parsed_cached_results", "quality_metrics", "total_reads")).to eq(100)
    end

    # SMP-1566: a CG run kicked off from an mNGS report starts from that run's retained non-host
    # reads. When the sample has no completed mNGS run the dispatcher raises
    # MngsInputsUnavailableError; the mutation must surface it as a clean GraphQL error the
    # consensus genome creation modal can show, not a dangling run or an unhandled 500.
    it "surfaces a clean GraphQL error when the mNGS non-host reads are unavailable" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project, user: @joe)

      allow_any_instance_of(Sample).to receive(:create_and_dispatch_workflow_run)
        .and_raise(SfnCgPipelineDispatchService::MngsInputsUnavailableError.new(sample.id))

      post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
        query: KICKOFF_WGS_MUTATION,
        variables: {
          sampleId: sample.id.to_s,
          input: {
            workflow: "consensus_genome",
            inputs_json: { accession_id: "KX1", technology: "Illumina" },
            authenticityToken: "t",
          },
        },
      }.to_json

      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to be_present
      expect(parsed["errors"].first["message"]).to match(/No completed mNGS run found for sample #{sample.id}/)
      expect(parsed.dig("data", "KickoffWGSWorkflow")).to be_nil
    end
  end
end

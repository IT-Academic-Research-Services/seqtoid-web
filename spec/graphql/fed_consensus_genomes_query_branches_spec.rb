require "rails_helper"

# Branch coverage for Queries::FedConsensusGenomesQuery. The existing
# fed_consensus_genomes_query_spec always supplies a fully-populated `input`, so the
# nullish-input guard never fires and every `td&.` safe-navigation only takes its
# "todoRemove present" arm. This file drives:
#   * input explicitly null -> the ExecutionError guard.
#   * input without todoRemove -> all eleven filter `td&.` hops plus order_by /
#     order_dir degrade to nil and discovery still returns rows.
#   * a discovery row with no sample info -> the `&.to_s` on the dug id degrades.
RSpec.describe GraphqlController, type: :request do
  create_users

  BRANCHES_DISCOVERY_QUERY = <<GQL
  query DiscoveryViewFCConsensusGenomeIdsQuery($input: queryInput_fedConsensusGenomes_input_Input) {
    fedConsensusGenomes(input: $input) {
      producingRunId
      sequencingRead {
        id
      }
    }
  }
GQL

  def post_query(query, variables)
    post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
      query: query,
      variables: variables,
    }.to_json
  end

  context "Joe" do
    before { sign_in @joe }

    it "raises a nullish-input execution error when input is explicitly null" do
      post_query(BRANCHES_DISCOVERY_QUERY, input: nil)

      expect(response).to have_http_status(:success)
      parsed = JSON.parse(response.body)
      expect(parsed.dig("data", "fedConsensusGenomes")).to be_nil
      expect(parsed["errors"].pluck("message")).to include("fedConsensusGenomes input was nullish")
    end

    it "runs discovery with every filter nil when todoRemove is omitted" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project, user: @joe)
      create(:workflow_run,
             sample: sample,
             user: @joe,
             workflow: WorkflowRun::WORKFLOW[:consensus_genome])

      # `where` present but producingRunId absent -> discovery mode; `todoRemove`
      # absent -> td is nil and every filter hop safe-navigates to nil.
      post_query(BRANCHES_DISCOVERY_QUERY, input: { where: {} })

      expect(response).to have_http_status(:success)
      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")

      data = parsed.dig("data", "fedConsensusGenomes")
      expect(data.length).to eq(1)
      expect(data.first["producingRunId"]).to be_nil
      expect(data.first.dig("sequencingRead", "id")).to eq(sample.id.to_s)
    end

    it "maps a discovery row with no sample info to a nil sequencing-read id" do
      allow_any_instance_of(Types::QueryType).to receive(:discovery_workflow_runs).and_return(
        workflow_runs: [{ "id" => 1, "sample" => {} }]
      )

      post_query(BRANCHES_DISCOVERY_QUERY, input: { todoRemove: { domain: "my_data" } })

      expect(response).to have_http_status(:success)
      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")

      data = parsed.dig("data", "fedConsensusGenomes")
      expect(data.length).to eq(1)
      expect(data.first.dig("sequencingRead", "id")).to be_nil
    end
  end
end

require "rails_helper"

# CZID-304: native Rails GraphQL port of the federation DeleteSamples mutation. Mirrors
# SamplesController#bulk_delete (DeletionValidationService -> BulkDeletionService). The
# deletion services are stubbed here so the spec never actually deletes anything.
RSpec.describe GraphqlController, type: :request do
  create_users

  DELETE_SAMPLES_MUTATION = <<GQL
  mutation BulkDeleteModalMutation($input: mutationInput_DeleteSamples_input_Input) {
    DeleteSamples(input: $input) {
      deleted_workflow_ids
      error
    }
  }
GQL

  def post_mutation(input)
    post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
      query: DELETE_SAMPLES_MUTATION,
      variables: { input: input },
    }.to_json
  end

  context "Joe" do
    before { sign_in @joe }

    it "deletes all-valid objects and returns stringified deleted ids" do
      allow(DeletionValidationService).to receive(:call).and_return(valid_ids: [11, 12], invalid_sample_ids: [], error: nil)
      allow(BulkDeletionService).to receive(:call).and_return(deleted_run_ids: [11, 12], deleted_sample_ids: [5], error: nil)

      post_mutation(idsStrings: ["11", "12"], workflow: "consensus-genome", authenticityToken: "t")

      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")
      expect(parsed.dig("data", "DeleteSamples")).to eq(
        "deleted_workflow_ids" => ["11", "12"], "error" => nil
      )
      expect(BulkDeletionService).to have_received(:call).with(object_ids: [11, 12], user: @joe, workflow: "consensus-genome")
    end

    it "surfaces a validation error without deleting" do
      allow(DeletionValidationService).to receive(:call).and_return(valid_ids: [], invalid_sample_ids: [], error: "Validation failed")
      expect(BulkDeletionService).not_to receive(:call)

      post_mutation(idsStrings: ["11"], workflow: "consensus-genome", authenticityToken: "t")

      parsed = JSON.parse(response.body)
      expect(parsed.dig("data", "DeleteSamples")).to eq("deleted_workflow_ids" => [], "error" => "Validation failed")
    end

    it "refuses to delete when not all selected ids are valid" do
      allow(DeletionValidationService).to receive(:call).and_return(valid_ids: [11], invalid_sample_ids: [], error: nil)
      expect(BulkDeletionService).not_to receive(:call)

      post_mutation(idsStrings: ["11", "12"], workflow: "consensus-genome", authenticityToken: "t")

      parsed = JSON.parse(response.body)
      data = parsed.dig("data", "DeleteSamples")
      expect(data["deleted_workflow_ids"]).to eq([])
      expect(data["error"]).to match(/not all objects valid/)
    end
  end
end

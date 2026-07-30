require "rails_helper"

# CZID-304: native Rails GraphQL port of the federation UpdateMetadata mutation. Mirrors
# SamplesController#save_metadata_v2 (Sample#metadatum_add_or_update) and the federation's
# @oneOf value handling (String branch preferred, else the location object).
RSpec.describe GraphqlController, type: :request do
  create_users

  UPDATE_METADATA_MUTATION = <<GQL
  mutation SampleDetailsModeUpdateMetadataMutation($sampleId: String!, $input: mutationInput_UpdateMetadata_input_Input!) {
    UpdateMetadata(sampleId: $sampleId, input: $input) {
      status
      message
    }
  }
GQL

  def post_mutation(variables)
    post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
      query: UPDATE_METADATA_MUTATION,
      variables: variables,
    }.to_json
  end

  context "Joe" do
    before { sign_in @joe }

    let(:sample) do
      project = create(:project, users: [@joe])
      create(:sample, project: project, user: @joe)
    end

    it "passes a String value through and maps ok -> success" do
      expect_any_instance_of(Sample).to receive(:metadatum_add_or_update)
        .with("collection_date", "2024-01-01").and_return(status: "ok")

      post_mutation(sampleId: sample.id.to_s, input: { field: "collection_date", value: { String: "2024-01-01" }, authenticityToken: "t" })

      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")
      expect(parsed.dig("data", "UpdateMetadata")).to eq("status" => "success", "message" => "Saved successfully")
    end

    it "passes a location object (string-keyed) through to the model" do
      location_data = { "name" => "San Francisco", "geo_level" => "city", "locationiq_id" => "123" }
      expect_any_instance_of(Sample).to receive(:metadatum_add_or_update)
        .with("collection_location_v2", location_data.to_json)
        .and_return(status: "ok")

      post_mutation(
        sampleId: sample.id.to_s,
        input: {
          field: "collection_location_v2",
          value: { query_SampleMetadata_metadata_items_location_validated_value_oneOf_1_Input: location_data },
          authenticityToken: "t",
        }
      )

      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")
      expect(parsed.dig("data", "UpdateMetadata", "status")).to eq("success")
    end

    it "passes a plain-text location as a string" do
      location_data = { name: "Just a string", title: "Just a string" }
      expect_any_instance_of(Sample).to receive(:metadatum_add_or_update)
        .with("collection_location_v2", "Just a string")
        .and_return(status: "ok")

      post_mutation(
        sampleId: sample.id.to_s,
        input: {
          field: "collection_location_v2",
          value: { query_SampleMetadata_metadata_items_location_validated_value_oneOf_1_Input: location_data },
          authenticityToken: "t",
        }
      )

      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")
      expect(parsed.dig("data", "UpdateMetadata", "status")).to eq("success")
    end

    it "maps a model error -> failed with the error message" do
      allow_any_instance_of(Sample).to receive(:metadatum_add_or_update)
        .and_return(status: "error", error: "Please input a number")

      post_mutation(sampleId: sample.id.to_s, input: { field: "host_age", value: { String: "abc" }, authenticityToken: "t" })

      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")
      expect(parsed.dig("data", "UpdateMetadata")).to eq("status" => "failed", "message" => "Please input a number")
    end
  end
end

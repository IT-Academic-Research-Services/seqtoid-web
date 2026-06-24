require "rails_helper"

RSpec.describe GraphqlController, type: :request do
  create_users

  query = <<GQL
  query SampleDetailsModeSampleMetadataFieldsQuery($snapshotLinkId: String, $input: queryInput_MetadataFields_input_Input!) {
    MetadataFields(snapshotLinkId: $snapshotLinkId, input: $input) {
      key
      dataType
      name
      options
      host_genome_ids
      description
      is_required
      isBoolean
      group
    }
  }
GQL

  context "Joe" do
    before { sign_in @joe }

    it "returns metadata fields for a single sample (field_info shape)" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project, user: @joe)
      allow_any_instance_of(Sample).to receive(:metadata_fields_info).and_return([
        { key: "collection_date", dataType: "date", name: "Collection Date", options: nil, group: "Sample", host_genome_ids: [1], description: "date desc", is_required: 1, examples: nil, default_for_new_host_genome: 0, isBoolean: false },
        { key: "nucleotide_type", dataType: "string", name: "Nucleotide Type", options: ["DNA", "RNA"], group: "Sample", host_genome_ids: [1, 2], description: "", is_required: 0, examples: nil, default_for_new_host_genome: 0, isBoolean: false },
      ])

      post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
        query: query,
        variables: { snapshotLinkId: nil, input: { sampleIds: [sample.id.to_s], authenticityToken: "token" } },
      }.to_json

      expect(response).to have_http_status(:success)
      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")
      data = parsed.dig("data", "MetadataFields")
      expect(data.length).to eq(2)
      expect(data[0]).to include(
        "key" => "collection_date", "dataType" => "date", "is_required" => 1,
        "isBoolean" => false, "host_genome_ids" => [1], "options" => nil
      )
      expect(data[1]).to include("options" => ["DNA", "RNA"], "host_genome_ids" => [1, 2])
    end
  end
end

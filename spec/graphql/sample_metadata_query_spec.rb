require "rails_helper"

# CZID-285: native Rails GraphQL port of the federation SampleMetadata op. Covers the
# federation post-processing this port reproduces — metadata id stringification, the
# location_validated_value union resolution, and the curated pipeline_run (stringified
# id + synthesized version map).
RSpec.describe GraphqlController, type: :request do
  create_users

  SAMPLE_METADATA_QUERY = <<GQL
  query SampleDetailsModeSampleMetadataQuery($sampleId: String!, $snapshotLinkId: String) {
    SampleMetadata(sampleId: $sampleId, snapshotLinkId: $snapshotLinkId) {
      metadata {
        id
        key
        sample_id
        raw_value
        string_validated_value
        location_id
        base_type
        location_validated_value {
          ... on query_SampleMetadata_metadata_items_location_validated_value_oneOf_0 {
            name
          }
          ... on query_SampleMetadata_metadata_items_location_validated_value_oneOf_1 {
            name
            id
            geo_level
            country_name
          }
        }
      }
      additional_info {
        name
        editable
        project_id
        project_name
        host_genome_name
        host_genome_taxa_category
        upload_date
        notes
        ercc_comparison {
          name
          actual
          expected
        }
        pipeline_run {
          id
          sample_id
          job_status
          pipeline_version
          version {
            pipeline
            alignment_db
          }
        }
        summary_stats {
          adjusted_remaining_reads
        }
      }
    }
  }
GQL

  def post_query(sample_id)
    post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
      query: SAMPLE_METADATA_QUERY,
      variables: { sampleId: sample_id.to_s, snapshotLinkId: nil },
    }.to_json
  end

  context "Joe" do
    before { sign_in @joe }

    it "stringifies metadata ids and resolves the location_validated_value union" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project, user: @joe)

      allow_any_instance_of(Sample).to receive(:metadata_with_base_type).and_return([
        # plain (non-location) field — no location_validated_value key -> null
        { "id" => 11, "key" => "sample_type", "sample_id" => sample.id,
          "raw_value" => "Serum", "string_validated_value" => "Serum", "base_type" => "string" },
        # structured location — resolved Location attributes (oneOf_1), integer id
        { "id" => 12, "key" => "collection_location_v2", "sample_id" => sample.id,
          "location_id" => 99, "base_type" => "location",
          "location_validated_value" => {
            "id" => 99, "name" => "San Francisco", "geo_level" => "city", "country_name" => "USA",
          }, },
        # free-text location — raw string (oneOf_0)
        { "id" => 13, "key" => "collection_location_free", "sample_id" => sample.id,
          "base_type" => "location", "location_validated_value" => "Unstructured place" },
      ])

      post_query(sample.id)

      expect(response).to have_http_status(:success)
      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")

      metadata = parsed.dig("data", "SampleMetadata", "metadata")
      expect(metadata.length).to eq(3)

      # ids stringified; non-location field has a null union
      expect(metadata[0]).to include("id" => "11", "key" => "sample_type", "sample_id" => sample.id)
      expect(metadata[0]["location_validated_value"]).to be_nil

      # structured location resolves to oneOf_1 with a stringified id
      expect(metadata[1]["id"]).to eq("12")
      expect(metadata[1]["location_validated_value"]).to eq(
        "name" => "San Francisco", "id" => "99", "geo_level" => "city", "country_name" => "USA"
      )

      # free-text location resolves to oneOf_0
      expect(metadata[2]["location_validated_value"]).to eq("name" => "Unstructured place")

      # additional_info scalars; no pipeline run on this sample
      info = parsed.dig("data", "SampleMetadata", "additional_info")
      expect(info).to include(
        "name" => sample.name,
        "editable" => true,
        "project_id" => project.id,
        "project_name" => project.name,
        # CZID-307 parity: federation passes the Rails REST JSON value (ISO8601 w/ ms), not Time#to_s.
        "upload_date" => sample.created_at.as_json
      )
      expect(info["pipeline_run"]).to be_nil
      expect(info["summary_stats"]).to be_nil
      expect(info["ercc_comparison"]).to be_nil
    end

    it "curates the pipeline_run with a stringified id and synthesized version map" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project, user: @joe)
      allow_any_instance_of(Sample).to receive(:metadata_with_base_type).and_return([])
      pr = create(:pipeline_run, sample: sample, pipeline_version: "8.0",
                                 job_status: PipelineRun::STATUS_CHECKED)

      post_query(sample.id)

      expect(response).to have_http_status(:success)
      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")

      pipeline_run = parsed.dig("data", "SampleMetadata", "additional_info", "pipeline_run")
      expect(pipeline_run["id"]).to eq(pr.id.to_s)
      expect(pipeline_run["sample_id"]).to eq(sample.id)
      expect(pipeline_run["job_status"]).to eq(PipelineRun::STATUS_CHECKED)
      expect(pipeline_run["version"]).to eq(
        "pipeline" => "8.0",
        "alignment_db" => pr.alignment_config.name
      )
    end
  end
end

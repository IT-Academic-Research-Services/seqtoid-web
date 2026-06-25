require "rails_helper"

# CZID-285 (303b): native Rails GraphQL port of the federation fedSequencingReads op.
# Covers the full discovery tree (sample subtree + consensus-genome edge aggregation,
# deduped by sample id) and the ids-only mode (selection set of just `{ id }`).
RSpec.describe GraphqlController, type: :request do
  create_users

  FULL_QUERY = <<GQL
  query DiscoveryViewFCSequencingReadsQuery($input: queryInput_fedSequencingReads_input_Input) {
    fedSequencingReads(input: $input) {
      id
      nucleicAcid
      protocol
      medakaModel
      technology
      taxon {
        name
      }
      sample {
        railsSampleId
        name
        notes
        collectionLocation
        sampleType
        waterControl
        uploadError
        hostOrganism {
          name
        }
        collection {
          name
          public
        }
        ownerUserId
        ownerUserName
        metadatas {
          edges {
            node {
              fieldName
              value
            }
          }
        }
      }
      consensusGenomes {
        edges {
          node {
            producingRunId
            taxon {
              name
            }
            accession {
              accessionId
              accessionName
            }
            metrics {
              coverageDepth
              totalReads
              gcPercent
              refSnps
              percentIdentity
              nActg
              percentGenomeCalled
              nMissing
              nAmbiguous
              referenceGenomeLength
            }
          }
        }
      }
    }
  }
GQL

  IDS_ONLY_QUERY = <<GQL
  query SequencingReadsIds($input: queryInput_fedSequencingReads_input_Input) {
    fedSequencingReads(input: $input) {
      id
    }
  }
GQL

  def post_query(query, variables)
    post "/graphql", headers: { "Content-Type" => "application/json" }, params: {
      query: query,
      variables: variables,
    }.to_json
  end

  # A with_sample_info-shaped run as format_workflow_runs would produce it.
  def cg_run(id:, accession_id:, is_public: true)
    {
      id: id,
      workflow: "consensus-genome",
      runner: { name: "Runner Joe", id: 7 },
      wdl_version: "3.4",
      created_at: "2026-01-01T00:00:00.000Z",
      status: "COMPLETE",
      cached_results: {
        quality_metrics: {
          total_reads: 1000, gc_percent: 38.0, ref_snps: 2, percent_identity: 99.9,
          n_actg: 29_900, percent_genome_called: 99.0, n_missing: 1, n_ambiguous: 0,
          reference_genome_length: 29_903
        },
        coverage_viz: { coverage_depth: 12.5 },
      },
      inputs: {
        "accession_id" => accession_id, "accession_name" => "SARS-CoV-2",
        "taxon_name" => "SARS-CoV-2", "wetlab_protocol" => "Artic",
        "medaka_model" => "r941", "technology" => "Nanopore"
      },
      sample: {
        info: {
          id: 55, name: "Sample A", sample_notes: "a note",
          host_genome_name: "Human", public: is_public
        },
        metadata: {
          "nucleotide_type" => "DNA", "collection_location_v2" => "San Francisco",
          "sample_type" => "Serum", "water_control" => "No", "host_age" => "30"
        },
        project_name: "Proj",
        uploader: { id: 7, name: "Uploader Joe" },
      },
    }
  end

  context "Joe" do
    before { sign_in @joe }

    it "builds the sequencing-read tree and aggregates a sample's CG runs into edges" do
      allow_any_instance_of(Types::QueryType).to receive(:discovery_workflow_runs).and_return(
        workflow_runs: [cg_run(id: 101, accession_id: "MN908947.3"), cg_run(id: 102, accession_id: "OTHER.1")]
      )

      post_query(FULL_QUERY, input: { todoRemove: { domain: "my_data", workflow: "consensus-genome" } })

      expect(response).to have_http_status(:success)
      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")

      data = parsed.dig("data", "fedSequencingReads")
      expect(data.length).to eq(1) # both runs share sample id 55 -> one read

      read = data.first
      expect(read).to include(
        "id" => "55",
        "nucleicAcid" => "DNA",
        "protocol" => "Artic",
        "medakaModel" => "r941",
        "technology" => "Nanopore"
      )
      expect(read["taxon"]).to eq("name" => "SARS-CoV-2")
      expect(read["sample"]).to include(
        "railsSampleId" => 55,
        "name" => "Sample A",
        "notes" => "a note",
        "collectionLocation" => "San Francisco",
        "sampleType" => "Serum",
        "waterControl" => false,
        "uploadError" => nil,
        "ownerUserId" => 7.0,
        "ownerUserName" => "Runner Joe"
      )
      expect(read.dig("sample", "hostOrganism", "name")).to eq("Human")
      expect(read.dig("sample", "collection")).to eq("name" => "Proj", "public" => true)
      # getMetadataEdges excludes the four promoted fields, leaving host_age
      expect(read.dig("sample", "metadatas", "edges")).to eq([
        { "node" => { "fieldName" => "host_age", "value" => "30" } },
      ])

      edges = read.dig("consensusGenomes", "edges")
      expect(edges.length).to eq(2)
      expect(edges.map { |e| e.dig("node", "producingRunId") }).to contain_exactly("101", "102")
      first_node = edges.first["node"]
      expect(first_node["accession"]).to eq("accessionId" => "MN908947.3", "accessionName" => "SARS-CoV-2")
      expect(first_node["metrics"]).to include(
        "coverageDepth" => 12.5, "totalReads" => 1000, "gcPercent" => 38.0,
        "refSnps" => 2, "nActg" => 29_900, "referenceGenomeLength" => 29_903.0
      )
    end

    # CZID-307 parity: the federation maps `public: Boolean(sampleInfo?.public)`; JS Boolean(0) is
    # false. A bare Ruby truthiness check treats 0 as true, so a private project (public_access 0)
    # wrongly reported public. Lock the JS-Boolean coercion.
    it "coerces a non-public collection (public_access 0) to false like the federation" do
      allow_any_instance_of(Types::QueryType).to receive(:discovery_workflow_runs).and_return(
        workflow_runs: [cg_run(id: 201, accession_id: "MN908947.3", is_public: 0)]
      )

      post_query(FULL_QUERY, input: { todoRemove: { domain: "my_data", workflow: "consensus-genome" } })

      expect(response).to have_http_status(:success)
      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")
      collection = parsed.dig("data", "fedSequencingReads", 0, "sample", "collection")
      expect(collection["public"]).to be(false)
    end

    it "returns unique sample ids in ids-only mode" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project, user: @joe)
      # two CG runs on the same sample -> one unique id
      create(:workflow_run, sample: sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:consensus_genome])
      create(:workflow_run, sample: sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:consensus_genome])

      post_query(IDS_ONLY_QUERY, input: { todoRemove: { domain: "my_data", workflow: "consensus-genome" } })

      expect(response).to have_http_status(:success)
      parsed = JSON.parse(response.body)
      expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")

      data = parsed.dig("data", "fedSequencingReads")
      expect(data).to eq([{ "id" => sample.id.to_s }])
    end
  end
end

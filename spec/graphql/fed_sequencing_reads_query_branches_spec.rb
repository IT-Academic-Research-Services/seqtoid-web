require "rails_helper"

# Branch coverage for Queries::FedSequencingReadsQuery. The sibling request specs run the
# resolver through the schema against real records, which always yields fully-populated
# runs: the "missing sample / missing inputs / missing cached_results" arms of the mapping
# helpers, the pagination fallbacks and the dedup arm of build_sequencing_reads never fire.
# These examples include the concern into a bare resolver host and feed it the JSON shapes
# the fetching pipeline can legitimately produce.
RSpec.describe Queries::FedSequencingReadsQuery do
  let(:resolver_class) do
    Class.new do
      def self.field(*_args, **_kwargs)
      end

      include Queries::FedSequencingReadsQuery

      def discovery_workflow_runs(**_kwargs)
        { workflow_runs: [] }
      end
    end
  end

  let(:resolver) { resolver_class.new }

  def lookahead_for(*field_names)
    selections = field_names.map { |name| double("Selection", field: double("Field", graphql_name: name)) }
    double("Lookahead", selections: selections)
  end

  describe "#resolve_fed_sequencing_reads" do
    it "raises when the input is nil" do
      expect { resolver.resolve_fed_sequencing_reads(lookahead: lookahead_for("id"), input: nil) }
        .to raise_error(GraphQL::ExecutionError, "fedSequencingReads input is nullish")
    end

    it "returns unique stringified sample ids in ids-only mode" do
      allow(resolver).to receive(:discovery_workflow_runs).and_return(
        workflow_runs: [
          { "sample" => { "info" => { "id" => 4 } } },
          { "sample" => { "info" => { "id" => 4 } } },
          { "sample" => { "info" => { "id" => 5 } } },
        ]
      )

      result = resolver.resolve_fed_sequencing_reads(lookahead: lookahead_for("id"), input: OpenStruct.new)

      expect(result).to eq([{ id: "4" }, { id: "5" }])
    end

    it "uses the basic mode and the full discovery window in ids-only mode" do
      captured = nil
      allow(resolver).to receive(:discovery_workflow_runs) do |**kwargs|
        captured = kwargs
        { workflow_runs: [] }
      end

      resolver.resolve_fed_sequencing_reads(lookahead: lookahead_for("id"), input: OpenStruct.new(offset: 25, limit: 5))

      expect(captured[:mode]).to eq("basic")
      expect(captured[:offset]).to eq(0)
      expect(captured[:limit]).to eq(Queries::FedWorkflowRunsQuery::DISCOVERY_LIMIT)
      expect(captured[:filters].values.compact).to be_empty
    end

    it "prefers the top-level offset/limit in full mode" do
      captured = nil
      allow(resolver).to receive(:discovery_workflow_runs) do |**kwargs|
        captured = kwargs
        { workflow_runs: [] }
      end

      resolver.resolve_fed_sequencing_reads(
        lookahead: lookahead_for("id", "sample"),
        input: OpenStruct.new(offset: 25, limit: 5, limitOffset: OpenStruct.new(offset: 99, limit: 99))
      )

      expect(captured[:mode]).to eq("with_sample_info")
      expect(captured[:offset]).to eq(25)
      expect(captured[:limit]).to eq(5)
    end

    it "falls back to limitOffset when the top-level offset/limit are absent" do
      captured = nil
      allow(resolver).to receive(:discovery_workflow_runs) do |**kwargs|
        captured = kwargs
        { workflow_runs: [] }
      end

      resolver.resolve_fed_sequencing_reads(
        lookahead: lookahead_for("sample"),
        input: OpenStruct.new(limitOffset: OpenStruct.new(offset: 40, limit: 20))
      )

      expect(captured[:offset]).to eq(40)
      expect(captured[:limit]).to eq(20)
    end

    it "falls back to 0 / MAX_PAGE_SIZE when neither pagination shape is supplied" do
      captured = nil
      allow(resolver).to receive(:discovery_workflow_runs) do |**kwargs|
        captured = kwargs
        { workflow_runs: [] }
      end

      resolver.resolve_fed_sequencing_reads(lookahead: lookahead_for("sample"), input: OpenStruct.new)

      expect(captured[:offset]).to eq(0)
      expect(captured[:limit]).to eq(WorkflowRunsController::MAX_PAGE_SIZE)
    end

    it "forwards every todoRemove filter when one is supplied" do
      captured = nil
      allow(resolver).to receive(:discovery_workflow_runs) do |**kwargs|
        captured = kwargs
        { workflow_runs: [] }
      end

      td = OpenStruct.new(
        domain: "public", search: "sars", host: [2], location_v2: ["NY"], tissue: ["nasal"],
        project_id: 8, visibility: ["public"], time: %w[2024-01-01 2024-03-01],
        workflow: "consensus-genome", taxons: [55], sample_ids: [1, 2], workflow_run_ids: [3],
        order_by: "sample", order_dir: "asc"
      )

      resolver.resolve_fed_sequencing_reads(lookahead: lookahead_for("id"), input: OpenStruct.new(todoRemove: td))

      expect(captured[:domain]).to eq("public")
      expect(captured[:order_by]).to eq("sample")
      expect(captured[:order_dir]).to eq("asc")
      expect(captured[:filters]).to include(
        search: "sars", taxon: [55], sampleIds: [1, 2], workflowRunIds: [3], projectId: 8
      )
    end
  end

  describe "#build_sequencing_reads" do
    it "collapses several runs for the same sample into one read with many CG edges" do
      runs = [
        { "id" => 1, "sample" => { "info" => { "id" => 9, "name" => "S1" } }, "inputs" => { "technology" => "Illumina" } },
        { "id" => 2, "sample" => { "info" => { "id" => 9, "name" => "S1" } }, "inputs" => {} },
      ]

      reads = resolver.send(:build_sequencing_reads, runs)

      expect(reads.size).to eq(1)
      expect(reads.first[:id]).to eq("9")
      expect(reads.first[:consensusGenomes][:edges].map { |e| e[:node][:producingRunId] }).to eq(%w[1 2])
    end

    it "defaults every field when the run carries no sample, inputs or metadata" do
      reads = resolver.send(:build_sequencing_reads, [{ "id" => 3 }])

      read = reads.first
      expect(read[:id]).to eq("")
      expect(read[:nucleicAcid]).to eq("")
      expect(read[:technology]).to eq("")
      expect(read[:taxon]).to be_nil
      expect(read[:sample][:name]).to eq("")
      expect(read[:sample][:hostOrganism]).to be_nil
      expect(read[:sample][:collection][:public]).to be(false)
      expect(read[:sample][:metadatas][:edges]).to eq([])
    end
  end

  describe "#build_sample" do
    let(:metadata) do
      {
        "nucleotide_type" => "DNA",
        "sample_type" => "Serum",
        "water_control" => "Yes",
        "collection_location_v2" => { "name" => "San Francisco" },
        "host_age" => 30,
      }
    end

    it "promotes the first-class metadata fields and excludes them from the generic edges" do
      sample = { "project_name" => "Proj", "uploader" => { "id" => 3, "name" => "Uploader" } }
      info = { "id" => 9, "name" => "S1", "host_genome_name" => "Human", "public" => 1 }

      built = resolver.send(:build_sample, { "runner" => { "name" => "Runner" } }, sample, info, metadata)

      expect(built[:sampleType]).to eq("Serum")
      expect(built[:waterControl]).to be(true)
      expect(built[:collectionLocation]).to eq("San Francisco")
      expect(built[:hostOrganism]).to eq(name: "Human")
      expect(built[:collection]).to eq(name: "Proj", public: true)
      expect(built[:ownerUserName]).to eq("Runner")
      expect(built[:metadatas][:edges]).to eq([{ node: { fieldName: "host_age", value: "30" } }])
    end

    it "falls back to the uploader name and treats public_access 0 as not public" do
      sample = { "uploader" => { "id" => 3, "name" => "Uploader" } }
      info = { "id" => 9, "public" => 0 }

      built = resolver.send(:build_sample, {}, sample, info, nil)

      expect(built[:ownerUserName]).to eq("Uploader")
      expect(built[:collection][:public]).to be(false)
      expect(built[:waterControl]).to be(false)
      expect(built[:sampleType]).to eq("")
    end
  end

  describe "#consensus_genome_edge" do
    it "reads the metrics out of cached_results when they are present" do
      run = {
        "id" => 77,
        "inputs" => { "taxon_name" => "SARS-CoV-2", "accession_id" => "MN908947.3", "accession_name" => "Wuhan-Hu-1" },
        "cached_results" => {
          "quality_metrics" => { "total_reads" => 100, "gc_percent" => 41.2 },
          "coverage_viz" => { "coverage_depth" => 9.5 },
        },
      }

      node = resolver.send(:consensus_genome_edge, run)[:node]

      expect(node[:producingRunId]).to eq("77")
      expect(node[:taxon]).to eq(name: "SARS-CoV-2")
      expect(node[:accession]).to eq(accessionId: "MN908947.3", accessionName: "Wuhan-Hu-1")
      expect(node[:metrics][:totalReads]).to eq(100)
      expect(node[:metrics][:coverageDepth]).to eq(9.5)
    end

    it "returns nil metrics and no accession when cached_results and inputs are missing" do
      node = resolver.send(:consensus_genome_edge, {})[:node]

      expect(node[:producingRunId]).to be_nil
      expect(node[:taxon]).to be_nil
      expect(node[:accession]).to be_nil
      expect(node[:metrics].values.compact).to be_empty
    end

    it "returns no accession when only one half of the accession pair is present" do
      node = resolver.send(:consensus_genome_edge, "inputs" => { "accession_id" => "MN908947.3" })[:node]

      expect(node[:referenceGenome]).to be_nil
    end
  end

  describe "#collection_location" do
    it "returns a plain string location as-is" do
      expect(resolver.send(:collection_location, "collection_location_v2" => "Oakland")).to eq("Oakland")
    end

    it "reads the name out of a location object" do
      expect(resolver.send(:collection_location, "collection_location_v2" => { "name" => "Oakland" })).to eq("Oakland")
    end

    it "returns an empty string when the location object has no name" do
      expect(resolver.send(:collection_location, "collection_location_v2" => {})).to eq("")
    end

    it "returns an empty string when there is no metadata at all" do
      expect(resolver.send(:collection_location, nil)).to eq("")
    end
  end

  describe "#metadata_edges" do
    it "returns an empty list when metadata is not a hash" do
      expect(resolver.send(:metadata_edges, nil)).to eq([])
    end

    it "stringifies values and drops the promoted fields" do
      edges = resolver.send(:metadata_edges, "sample_type" => "Serum", "host_age" => 12)

      expect(edges).to eq([{ node: { fieldName: "host_age", value: "12" } }])
    end
  end
end

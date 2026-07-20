# frozen_string_literal: true

require "rails_helper"

# Branch sweep for the Queries::FedSequencingReadsQuery concern (CZID-285/303b). The
# existing spec (spec/graphql/fed_sequencing_reads_query_spec.rb) is a full request spec
# that exercises the happy discovery tree, but the pure hash-shaping helpers have many
# untaken arms (nil / empty / non-Hash / fallback branches). These drive each private
# helper directly through plain hashes (no DB, no GraphQL execution) so every arm is
# exercised in isolation, and each test fails if its arm is inverted/removed.
#
# Branches driven:
#   - ids_only_selection?: selection == ["id"] true vs false.
#   - build_sequencing_reads: dedup key? hit (append edge) vs miss (new read); id&.to_s || "".
#   - build_sample: name || ""; water_control == "Yes" both ways; host_genome_name ?:{} vs nil;
#     the JS-Boolean public coercion (truthy vs 0/""/nil/false falsy); ownerUserName || fallback.
#   - consensus_genome_edge: inputs || {} and cached_results digs || {}.
#   - taxon_for: name present -> hash vs nil.
#   - accession_for: both present -> hash vs either missing -> nil.
#   - collection_location: String passthrough vs Hash["name"] vs empty-string fallback.
#   - metadata_value: Hash vs non-Hash.
#   - metadata_edges: non-Hash -> [] vs Hash -> reject-exclusions + map.
RSpec.describe Queries::FedSequencingReadsQuery, type: :concern do
  # Host mixing in the concern. The `included do field ... end` block needs a `field`
  # DSL method on the host; a no-op class method that ignores its block satisfies it
  # without pulling in graphql-ruby's schema machinery.
  let(:host_class) do
    Class.new do
      def self.field(*_args, **_kwargs); end
      include Queries::FedSequencingReadsQuery
    end
  end

  let(:host) { host_class.new }

  describe "#ids_only_selection?" do
    def lookahead_for(names)
      selections = names.map { |n| double("sel", field: double("f", graphql_name: n)) }
      double("lookahead", selections: selections)
    end

    it "is true when the selection set is exactly [id]" do
      expect(host.send(:ids_only_selection?, lookahead_for(["id"]))).to be(true)
    end

    it "is false when other fields are selected too" do
      expect(host.send(:ids_only_selection?, lookahead_for(%w[id name]))).to be(false)
    end
  end

  describe "#build_sequencing_reads dedup" do
    def run_for(sample_id, run_id)
      { "id" => run_id, "sample" => { "info" => { "id" => sample_id } }, "inputs" => {} }
    end

    it "collapses two runs with the same sample id into one read with two CG edges" do
      result = host.send(:build_sequencing_reads, [run_for(5, 100), run_for(5, 101)])

      expect(result.size).to eq(1)
      expect(result.first[:consensusGenomes][:edges].size).to eq(2)
    end

    it "keeps distinct sample ids as separate reads (the else/new arm)" do
      result = host.send(:build_sequencing_reads, [run_for(5, 100), run_for(6, 200)])

      expect(result.size).to eq(2)
      expect(result.map { |r| r[:id] }).to contain_exactly("5", "6")
    end

    it "coerces a missing sample id to the empty-string key" do
      run = { "id" => 1, "sample" => { "info" => {} }, "inputs" => {} }
      result = host.send(:build_sequencing_reads, [run])

      expect(result.first[:id]).to eq("")
    end
  end

  describe "#build_sample" do
    def build(info: {}, metadata: {}, sample: {}, run: {})
      full_sample = sample.merge("info" => info, "metadata" => metadata)
      host.send(:build_sample, run, full_sample, info, metadata)
    end

    it "defaults a missing sample name to the empty string" do
      expect(build(info: {})[:name]).to eq("")
    end

    it "sets waterControl true only when the metadata value is exactly 'Yes'" do
      expect(build(metadata: { "water_control" => "Yes" })[:waterControl]).to be(true)
      expect(build(metadata: { "water_control" => "No" })[:waterControl]).to be(false)
    end

    it "wraps host_genome_name in a hash when present, else nil" do
      expect(build(info: { "host_genome_name" => "Human" })[:hostOrganism]).to eq(name: "Human")
      expect(build(info: {})[:hostOrganism]).to be_nil
    end

    it "coerces project public with JS-Boolean semantics (0 and '' are falsy)" do
      expect(build(info: { "public" => 1 })[:collection][:public]).to be(true)
      expect(build(info: { "public" => 0 })[:collection][:public]).to be(false)
      expect(build(info: { "public" => "" })[:collection][:public]).to be(false)
      expect(build(info: { "public" => nil })[:collection][:public]).to be(false)
    end

    it "prefers the runner name for ownerUserName, falling back to the uploader" do
      via_runner = build(run: { "runner" => { "name" => "R" } }, sample: { "uploader" => { "name" => "U" } })
      via_uploader = build(run: {}, sample: { "uploader" => { "name" => "U" } })

      expect(via_runner[:ownerUserName]).to eq("R")
      expect(via_uploader[:ownerUserName]).to eq("U")
    end
  end

  describe "#consensus_genome_edge" do
    it "defaults missing inputs and cached_results to empty hashes (nil-coalesce arms)" do
      edge = host.send(:consensus_genome_edge, { "id" => 9 })

      expect(edge[:node][:producingRunId]).to eq("9")
      expect(edge[:node][:taxon]).to be_nil
      expect(edge[:node][:metrics][:totalReads]).to be_nil
    end

    it "reads metrics from cached_results when present" do
      run = { "id" => 9, "inputs" => {}, "cached_results" => { "quality_metrics" => { "total_reads" => 42 } } }
      edge = host.send(:consensus_genome_edge, run)

      expect(edge[:node][:metrics][:totalReads]).to eq(42)
    end
  end

  describe "#taxon_for" do
    it "returns a name hash when taxon_name is present" do
      expect(host.send(:taxon_for, { "taxon_name" => "SARS-CoV-2" })).to eq(name: "SARS-CoV-2")
    end

    it "returns nil when taxon_name is absent" do
      expect(host.send(:taxon_for, {})).to be_nil
    end
  end

  describe "#accession_for" do
    it "returns the accession hash only when both id and name are present" do
      result = host.send(:accession_for, { "accession_id" => "MN908947", "accession_name" => "ref" })
      expect(result).to eq(accessionId: "MN908947", accessionName: "ref")
    end

    it "returns nil when either accession field is missing" do
      expect(host.send(:accession_for, { "accession_id" => "MN908947" })).to be_nil
      expect(host.send(:accession_for, { "accession_name" => "ref" })).to be_nil
    end
  end

  describe "#collection_location" do
    it "passes a String location through unchanged" do
      expect(host.send(:collection_location, { "collection_location_v2" => "San Francisco" }))
        .to eq("San Francisco")
    end

    it "reads the name out of a Hash location" do
      expect(host.send(:collection_location, { "collection_location_v2" => { "name" => "SF" } }))
        .to eq("SF")
    end

    it "falls back to empty string when the location is neither String nor named Hash" do
      expect(host.send(:collection_location, { "collection_location_v2" => nil })).to eq("")
      expect(host.send(:collection_location, { "collection_location_v2" => {} })).to eq("")
    end
  end

  describe "#metadata_value" do
    it "reads a key from a Hash metadata" do
      expect(host.send(:metadata_value, { "sample_type" => "blood" }, "sample_type")).to eq("blood")
    end

    it "returns nil when metadata is not a Hash" do
      expect(host.send(:metadata_value, nil, "sample_type")).to be_nil
    end
  end

  describe "#metadata_edges" do
    it "returns [] when metadata is not a Hash" do
      expect(host.send(:metadata_edges, "not a hash")).to eq([])
    end

    it "drops the promoted-field exclusions and maps the rest to edges" do
      metadata = { "sample_type" => "blood", "custom" => "x", "water_control" => "Yes" }
      edges = host.send(:metadata_edges, metadata)

      names = edges.map { |e| e[:node][:fieldName] }
      expect(names).to eq(["custom"])
      expect(edges.first[:node][:value]).to eq("x")
    end
  end
end

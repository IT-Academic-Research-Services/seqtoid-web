# frozen_string_literal: true

require "rails_helper"

# Branch sweep for the Queries::FedConsensusGenomesQuery concern (CZID-285/303b). The
# existing spec is a full request spec; these drive the private shaping helpers directly
# through doubles (no schema execution) so the conditional-assignment and download-url
# guard arms the request path does not vary are each exercised in isolation.
#
# Branches driven (each fails if its arm is inverted/removed):
#   - single_consensus_genome_result: WORKFLOW_CLASS present -> becomes(class) vs nil -> unchanged;
#     data[x] || {} nil-coalesce; accession assigned iff id && name; taxon assigned iff id && name.
#   - reference_genome_download_url: both s3_path & filename present -> presigned url;
#     s3_path missing -> nil; filename missing -> nil.
RSpec.describe Queries::FedConsensusGenomesQuery, type: :concern do
  # Host mixing in the concern. The `included do field ... end` needs a no-op `field`
  # DSL method; the concern also reads current_power, stubbed per-example.
  let(:host_class) do
    Class.new do
      def self.field(*_args, **_kwargs); end
      include Queries::FedConsensusGenomesQuery
      attr_accessor :current_power
    end
  end

  let(:host) { host_class.new }

  describe "#single_consensus_genome_result" do
    # A workflow_run double whose results.as_json returns the given data hash.
    def wr_double(workflow:, data:)
      wr = double("workflow_run", workflow: workflow)
      allow(wr).to receive(:results).and_return(double("results", as_json: data))
      allow(wr).to receive(:becomes) { |_klass| wr }
      wr
    end

    def wire(wr)
      host.current_power = double("power", workflow_runs: double("runs", find: wr))
      allow(host).to receive(:reference_genome_download_url).and_return("http://example/ref.fa")
    end

    it "does NOT call becomes when the workflow has no mapped class (the nil/else arm)" do
      wr = wr_double(workflow: "no-such-workflow", data: {})
      wire(wr)

      host.send(:single_consensus_genome_result, 1)

      expect(wr).not_to have_received(:becomes)
    end

    it "casts via becomes when the workflow maps to a class (the present arm)" do
      cg = WorkflowRun::WORKFLOW[:consensus_genome]
      wr = wr_double(workflow: cg, data: {})
      wire(wr)

      host.send(:single_consensus_genome_result, 1)

      expect(wr).to have_received(:becomes).with(WorkflowRun::WORKFLOW_CLASS[cg])
    end

    it "builds the accession and taxon hashes when both of each pair are present" do
      data = {
        "taxon_info" => {
          "accession_id" => "MN908947", "accession_name" => "ref",
          "taxon_id" => 2_697_049, "taxon_name" => "SARS-CoV-2"
        },
      }
      wr = wr_double(workflow: "x", data: data)
      wire(wr)

      result = host.send(:single_consensus_genome_result, 1)

      expect(result[:accession]).to eq(accessionId: "MN908947", accessionName: "ref")
      expect(result[:taxon]).to eq(id: "2697049", name: "SARS-CoV-2", commonName: "SARS-CoV-2")
    end

    it "leaves accession and taxon nil when a member of each pair is missing" do
      data = {
        "taxon_info" => { "accession_id" => "MN908947", "taxon_id" => 2_697_049 },
      }
      wr = wr_double(workflow: "x", data: data)
      wire(wr)

      result = host.send(:single_consensus_genome_result, 1)

      # accession_name / taxon_name absent -> the `if ... end` yields nil for both.
      expect(result[:accession]).to be_nil
      expect(result[:taxon]).to be_nil
    end

    it "defaults missing result sections to empty hashes (the data[x] || {} arms)" do
      wr = wr_double(workflow: "x", data: {})
      wire(wr)

      result = host.send(:single_consensus_genome_result, 1)

      # No coverage_viz/quality_metrics in data -> nil-coalesced to {}, so every metric reads nil.
      expect(result[:metrics][:coverageDepth]).to be_nil
      expect(result[:metrics][:gcPercent]).to be_nil
    end
  end

  describe "#reference_genome_download_url" do
    def wr_with(s3_path:, filename:)
      ref = s3_path.nil? ? nil : double("input_file", s3_path: s3_path)
      input_files = double("input_files")
      allow(input_files).to receive(:reference_sequence).and_return([ref])
      sample = double("sample", input_files: input_files, name: "samp")
      inputs = filename.nil? ? nil : { "ref_fasta" => filename }
      double("workflow_run", sample: sample, inputs: inputs, id: 77)
    end

    it "returns a presigned url when both the s3 path and ref_fasta filename are present" do
      wr = wr_with(s3_path: "s3://bucket/ref.fa", filename: "ref.fa")
      allow(host).to receive(:get_presigned_s3_url).and_return("http://signed")

      expect(host.send(:reference_genome_download_url, wr)).to eq("http://signed")
      expect(host).to have_received(:get_presigned_s3_url)
        .with(s3_path: "s3://bucket/ref.fa", filename: "samp_77_ref.fa")
    end

    it "returns nil when the reference sequence has no s3 path" do
      wr = wr_with(s3_path: nil, filename: "ref.fa")
      allow(host).to receive(:get_presigned_s3_url)

      expect(host.send(:reference_genome_download_url, wr)).to be_nil
      expect(host).not_to have_received(:get_presigned_s3_url)
    end

    it "returns nil when the run has no ref_fasta input filename" do
      wr = wr_with(s3_path: "s3://bucket/ref.fa", filename: nil)
      allow(host).to receive(:get_presigned_s3_url)

      expect(host.send(:reference_genome_download_url, wr)).to be_nil
      expect(host).not_to have_received(:get_presigned_s3_url)
    end
  end
end

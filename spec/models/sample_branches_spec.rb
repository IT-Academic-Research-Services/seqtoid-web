require 'rails_helper'

# Coverage Wave (branch): sample_spec.rb covers upload/basespace/sort machinery
# but leaves several small pure predicate/derivation branches undriven. This
# spec drives ONLY those branches (no DB writes, no AWS) so each arm is hit and
# each test fails if its branch is inverted or removed:
#   - #fasta_input?: extension in the fasta set (true) vs not (false)
#   - #skip_deutero_filter_flag: the `!host_genome || skip == 1 ? 1 : 0` arms
#   - #host_genome_name: the trailing `if host_genome` guard, both arms
#   - #default_background_id: the host-genome default present arm vs the fallback
#   - .group_taxon_count_filters_by_count_type: the `>=` gteq/lteq ternary and the
#     first-seen-vs-append `result[type].nil?` branch
RSpec.describe Sample, type: :model do
  describe "#fasta_input?" do
    it "is true when the first input file has a fasta extension (include? true)" do
      sample = Sample.new
      allow(sample).to receive(:input_files).and_return([double("input_file", file_extension: "fa")])
      expect(sample.fasta_input?).to eq(true)
    end

    it "is false when the first input file is fastq (include? false)" do
      sample = Sample.new
      allow(sample).to receive(:input_files).and_return([double("input_file", file_extension: "fastq")])
      expect(sample.fasta_input?).to eq(false)
    end
  end

  describe "#skip_deutero_filter_flag" do
    it "is 1 when there is no host genome (first || operand true)" do
      sample = Sample.new
      allow(sample).to receive(:host_genome).and_return(nil)
      expect(sample.skip_deutero_filter_flag).to eq(1)
    end

    it "is 1 when the host genome opts to skip the deutero filter (second || operand true)" do
      sample = Sample.new
      allow(sample).to receive(:host_genome).and_return(double("hg", skip_deutero_filter: 1))
      expect(sample.skip_deutero_filter_flag).to eq(1)
    end

    it "is 0 when a host genome is present and does not skip the deutero filter (both operands false)" do
      sample = Sample.new
      allow(sample).to receive(:host_genome).and_return(double("hg", skip_deutero_filter: 0))
      expect(sample.skip_deutero_filter_flag).to eq(0)
    end
  end

  describe "#host_genome_name" do
    it "returns the host genome name when present (guard true)" do
      sample = Sample.new
      allow(sample).to receive(:host_genome).and_return(double("hg", name: "Human"))
      expect(sample.host_genome_name).to eq("Human")
    end

    it "returns nil when there is no host genome (guard false)" do
      sample = Sample.new
      allow(sample).to receive(:host_genome).and_return(nil)
      expect(sample.host_genome_name).to be_nil
    end
  end

  describe "#default_background_id" do
    it "uses the host genome's default background when present (ternary true arm)" do
      sample = Sample.new
      allow(sample).to receive(:host_genome).and_return(double("hg", default_background_id: 3))
      expect(sample.default_background_id).to eq(3)
    end

    it "falls back to the Human host genome default when absent (ternary false arm)" do
      sample = Sample.new
      allow(sample).to receive(:host_genome).and_return(nil)
      allow(HostGenome).to receive(:find_by).with(name: "Human").and_return(double("human", default_background_id: 99))
      expect(sample.default_background_id).to eq(99)
    end
  end

  describe ".group_taxon_count_filters_by_count_type" do
    it "uses gteq for a '>=' operator and creates the array on first sight of a count type" do
      filters = [{ count_type: "nt", metric: "rpm", operator: ">=", value: "5" }]
      result = Sample.group_taxon_count_filters_by_count_type(filters)

      expect(result.keys).to eq(["NT"])
      expect(result["NT"].size).to eq(1)
      expect(result["NT"].first).to include(">=")
      expect(result["NT"].first).not_to include("<=")
    end

    it "uses lteq for a non-'>=' operator and appends to an existing count type (nil? false arm)" do
      filters = [
        { count_type: "nr", metric: "rpm", operator: ">=", value: "5" },
        { count_type: "nr", metric: "count", operator: "<=", value: "10" },
      ]
      result = Sample.group_taxon_count_filters_by_count_type(filters)

      expect(result.keys).to eq(["NR"])
      expect(result["NR"].size).to eq(2)
      expect(result["NR"].last).to include("<=")
    end
  end
end

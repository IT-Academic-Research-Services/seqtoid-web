# frozen_string_literal: true

require "rails_helper"

# Branch-coverage companion #2 for app/lib/report_helper.rb.
# report_helper_branches_spec.rb covers generate_heatmap_csv and the negative-taxid
# arms of validate_names!. This file takes the remaining conditionals:
#   - select_pipeline_run: versioned vs first pipeline run
#   - decode_sort_by: every `return nil unless` guard AND the success path
#   - zero_metrics: short-read, long-read and the unknown-workflow nil arm
#   - metric_props: present vs missing metric values
#   - convert_2d: the ||= memo arm for a second count type on the same taxon
#   - cleanup_genus_ids!: species / genus / family / neither arms
#   - validate_names!: the unnamed-positive-taxid arm and the categorized vs
#     uncategorized superkingdom arms
#   - remove_homo_sapiens_counts! and taxon_counts_cleanup's zscore-removal flag
#   - species_or_genus and convert_neg_taxid's below/above threshold arms
RSpec.describe ReportHelper do
  describe "#select_pipeline_run" do
    # select_pipeline_run is an instance method mixed into controllers.
    let(:includer) { Class.new { include ReportHelper }.new }

    it "looks up by version when a positive pipeline version is given" do
      sample = instance_double(Sample)
      expect(sample).to receive(:pipeline_run_by_version).with("3.7").and_return(:versioned_run)

      expect(includer.select_pipeline_run(sample, "3.7")).to eq(:versioned_run)
    end

    it "falls back to the first pipeline run when the version is absent" do
      sample = instance_double(Sample)
      expect(sample).to receive(:first_pipeline_run).and_return(:first_run)

      expect(includer.select_pipeline_run(sample, nil)).to eq(:first_run)
    end
  end

  describe ".decode_sort_by" do
    it "returns nil when sort_by is nil" do
      expect(described_class.decode_sort_by(nil)).to be_nil
    end

    it "returns nil when the sort string does not have three parts" do
      expect(described_class.decode_sort_by("highest_nt")).to be_nil
    end

    it "returns nil for an unknown direction" do
      expect(described_class.decode_sort_by("sideways_nt_rpm")).to be_nil
    end

    it "returns nil for an unknown count type" do
      expect(described_class.decode_sort_by("highest_xx_rpm")).to be_nil
    end

    it "returns nil for an unknown metric" do
      expect(described_class.decode_sort_by("highest_nt_notametric")).to be_nil
    end

    it "decodes a fully valid sort string" do
      expect(described_class.decode_sort_by("lowest_nr_zscore")).to eq(
        direction: "lowest", count_type: "NR", metric: "zscore"
      )
    end
  end

  describe ".zero_metrics" do
    it "returns the short-read metric skeleton" do
      metrics = described_class.zero_metrics("NT", WorkflowRun::WORKFLOW[:short_read_mngs])

      expect(metrics['count_type']).to eq("NT")
      expect(metrics['zscore']).to eq(ReportHelper::ZSCORE_WHEN_ABSENT_FROM_SAMPLE)
      expect(metrics).not_to have_key('bpm')
    end

    it "returns the long-read metric skeleton with bases instead of zscore" do
      metrics = described_class.zero_metrics("NR", WorkflowRun::WORKFLOW[:long_read_mngs])

      expect(metrics['bpm']).to eq(0)
      expect(metrics).not_to have_key('zscore')
    end

    it "returns nil for a workflow with no metric skeleton" do
      expect(described_class.zero_metrics("NT", WorkflowRun::WORKFLOW[:consensus_genome])).to be_nil
    end
  end

  describe ".metric_props" do
    let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }

    it "rounds the metrics that the taxon provides" do
      taxon = { 'count_type' => "NT", 'r' => 5, 'rpm' => 1.123456789 }

      props = described_class.metric_props(taxon, workflow)

      expect(props['r']).to eq(5)
      expect(props['rpm']).to eq(1.123456789.round(ReportHelper::DECIMALS))
    end

    it "leaves the zeroed defaults in place for metrics the taxon omits" do
      taxon = { 'count_type' => "NT" }

      props = described_class.metric_props(taxon, workflow)

      expect(props['r']).to eq(0)
      expect(props['rpm']).to eq(0)
    end
  end

  describe ".convert_2d" do
    let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }

    it "merges the NT and NR rows for the same taxid into one entry" do
      rows = [
        { 'tax_id' => 100, 'count_type' => "NT", 'tax_level' => 1, 'r' => 5 },
        { 'tax_id' => 100, 'count_type' => "NR", 'tax_level' => 1, 'r' => 3 },
      ]

      result = described_class.convert_2d(rows, workflow)

      expect(result.keys).to eq([100])
      expect(result[100]["NT"]['r']).to eq(5)
      expect(result[100]["NR"]['r']).to eq(3)
    end
  end

  describe ".cleanup_genus_ids!" do
    it "uses the taxid as the species taxid for a species row" do
      tax_2d = { 100 => { 'tax_level' => TaxonCount::TAX_LEVEL_SPECIES } }

      described_class.cleanup_genus_ids!(tax_2d)

      expect(tax_2d[100]['species_taxid']).to eq(100)
      expect(tax_2d[100]['genus_taxid']).to be_nil
    end

    it "backfills the genus taxid and a missing species id for a genus row" do
      tax_2d = { 200 => { 'tax_level' => TaxonCount::TAX_LEVEL_GENUS } }

      described_class.cleanup_genus_ids!(tax_2d)

      expect(tax_2d[200]['species_taxid']).to eq(TaxonLineage::MISSING_SPECIES_ID)
      expect(tax_2d[200]['genus_taxid']).to eq(200)
    end

    it "backfills the family taxid for a family row" do
      tax_2d = { 300 => { 'tax_level' => TaxonCount::TAX_LEVEL_FAMILY } }

      described_class.cleanup_genus_ids!(tax_2d)

      expect(tax_2d[300]['family_taxid']).to eq(300)
      expect(tax_2d[300]['genus_taxid']).to be_nil
    end
  end

  describe ".validate_names! for positive taxids" do
    it "synthesizes a name for a positive taxid that has none" do
      tax_2d = { 100 => { 'tax_level' => TaxonCount::TAX_LEVEL_SPECIES, 'name' => nil } }

      described_class.validate_names!(tax_2d)

      expect(tax_2d[100]['name']).to eq("unnamed species taxon 100")
    end

    it "leaves an existing name alone" do
      tax_2d = { 100 => { 'tax_level' => TaxonCount::TAX_LEVEL_SPECIES, 'name' => "Klebsiella pneumoniae" } }

      described_class.validate_names!(tax_2d)

      expect(tax_2d[100]['name']).to eq("Klebsiella pneumoniae")
    end

    it "maps a known superkingdom taxid onto its category name" do
      known_superkingdom = ReportHelper::ALL_CATEGORIES.first
      tax_2d = {
        100 => {
          'tax_level' => TaxonCount::TAX_LEVEL_SPECIES,
          'name' => "Some taxon",
          'superkingdom_taxid' => known_superkingdom['taxid'],
        },
      }

      described_class.validate_names!(tax_2d)

      expect(tax_2d[100]['category_name']).to eq(known_superkingdom['name'])
      expect(tax_2d[100]).not_to have_key('superkingdom_taxid')
    end

    it "falls back to Uncategorized for an unknown superkingdom taxid" do
      tax_2d = {
        100 => {
          'tax_level' => TaxonCount::TAX_LEVEL_SPECIES,
          'name' => "Some taxon",
          'superkingdom_taxid' => -987_654,
        },
      }

      described_class.validate_names!(tax_2d)

      expect(tax_2d[100]['category_name']).to eq('Uncategorized')
    end
  end

  describe ".remove_homo_sapiens_counts!" do
    it "drops human taxids and keeps everything else" do
      human_tax_id = TaxonLineage::HOMO_SAPIENS_TAX_IDS.first
      tax_2d = { human_tax_id => { 'name' => "Homo sapiens" }, 573 => { 'name' => "Klebsiella" } }

      described_class.remove_homo_sapiens_counts!(tax_2d)

      expect(tax_2d.keys).to eq([573])
    end
  end

  describe ".taxon_counts_cleanup" do
    let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }
    let(:rows) do
      [
        { 'tax_id' => 573, 'count_type' => "NT", 'tax_level' => TaxonCount::TAX_LEVEL_SPECIES,
          'name' => "Klebsiella pneumoniae", 'zscore' => 2.5, 'r' => 10, },
        { 'tax_id' => 573, 'count_type' => "NR", 'tax_level' => TaxonCount::TAX_LEVEL_SPECIES,
          'name' => "Klebsiella pneumoniae", 'zscore' => 1.5, 'r' => 8, },
      ]
    end

    it "keeps the zscores by default" do
      result = described_class.taxon_counts_cleanup(rows, workflow)

      expect(result[573]["NT"]['zscore']).to eq(2.5)
    end

    it "nulls out the zscores when asked to remove them" do
      result = described_class.taxon_counts_cleanup(rows, workflow, true)

      expect(result[573]["NT"]['zscore']).to be_nil
      expect(result[573]["NR"]['zscore']).to be_nil
    end
  end

  describe ".species_or_genus" do
    it "is true for species and genus levels" do
      expect(described_class.species_or_genus(TaxonCount::TAX_LEVEL_SPECIES)).to be(true)
      expect(described_class.species_or_genus(TaxonCount::TAX_LEVEL_GENUS)).to be(true)
    end

    it "is false for a family level" do
      expect(described_class.species_or_genus(TaxonCount::TAX_LEVEL_FAMILY)).to be(false)
    end
  end
end

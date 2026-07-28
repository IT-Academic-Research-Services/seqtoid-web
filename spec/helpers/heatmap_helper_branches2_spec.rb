# frozen_string_literal: true

require "rails_helper"

# Branch-coverage companion #2 for app/helpers/heatmap_helper.rb.
# The coverage/branches-1 specs drive sample_taxons_dict parameter parsing and
# the happy paths of the detail builders. This file takes the arms they leave:
#   - parse_custom_filters: the unparseable-value rescue arm and the else arm
#   - apply_custom_filters: the ">=" rejection arm and the ">=" pass arm
#   - only_species_level_counts!: kept vs dropped rows
#   - compute_aggregate_scores_v2!: NT-higher vs NR-higher maxzscore
#   - samples_taxons_details: the alignment_config present vs nil safe-navigation
#   - fetch_samples_taxons_counts: the "second row for a pipeline run already in
#     the hash" arm, the mass-normalized zscore arm and the ZSCORE_MIN clamp
RSpec.describe HeatmapHelper, type: :helper do
  describe ".parse_custom_filters" do
    it "keeps a filter whose value parses as a float" do
      parsed = HeatmapHelper.parse_custom_filters([{ "metric" => "NT_rpm", "value" => "5.5", "operator" => ">=" }])

      expect(parsed).to eq([{ count_type: "NT", metric: "rpm", value: 5.5, operator: ">=" }])
    end

    it "drops a filter whose value is not a number and warns" do
      expect(Rails.logger).to receive(:warn).with("Bad threshold filter value.")

      parsed = HeatmapHelper.parse_custom_filters([{ "metric" => "NT_rpm", "value" => "abc", "operator" => ">=" }])

      expect(parsed).to eq([])
    end
  end

  describe ".apply_custom_filters" do
    let(:row) { { "NT" => { "rpm" => 10 }, "NR" => { "zscore" => 3 } } }

    it "rejects a row that falls below a >= threshold" do
      filters = [{ "metric" => "NT_rpm", "value" => "50", "operator" => ">=" }]

      expect(HeatmapHelper.apply_custom_filters(row, filters)).to be(false)
    end

    it "accepts a row that meets a >= threshold" do
      filters = [{ "metric" => "NT_rpm", "value" => "10", "operator" => ">=" }]

      expect(HeatmapHelper.apply_custom_filters(row, filters)).to be(true)
    end

    it "rejects a row that exceeds a <= threshold" do
      filters = [{ "metric" => "NR_zscore", "value" => "1", "operator" => "<=" }]

      expect(HeatmapHelper.apply_custom_filters(row, filters)).to be(false)
    end

    it "accepts any row when there are no filters" do
      expect(HeatmapHelper.apply_custom_filters(row, [])).to be(true)
    end
  end

  describe ".only_species_level_counts!" do
    it "keeps species rows and drops everything else" do
      tax_2d = {
        1 => { 'tax_level' => TaxonCount::TAX_LEVEL_SPECIES },
        2 => { 'tax_level' => TaxonCount::TAX_LEVEL_GENUS },
      }

      HeatmapHelper.only_species_level_counts!(tax_2d)

      expect(tax_2d.keys).to eq([1])
    end
  end

  describe ".compute_aggregate_scores_v2!" do
    it "uses the NT zscore when it is the larger of the two" do
      rows = [{ "NT" => { "zscore" => 9.0 }, "NR" => { "zscore" => 2.0 } }]

      HeatmapHelper.compute_aggregate_scores_v2!(rows)

      expect(rows[0]["NT"]['maxzscore']).to eq(9.0)
      expect(rows[0]["NR"]['maxzscore']).to eq(9.0)
    end

    it "uses the NR zscore when it is the larger of the two" do
      rows = [{ "NT" => { "zscore" => 1.0 }, "NR" => { "zscore" => 7.0 } }]

      HeatmapHelper.compute_aggregate_scores_v2!(rows)

      expect(rows[0]["NT"]['maxzscore']).to eq(7.0)
    end
  end

  describe ".samples_taxons_details alignment config" do
    def build_sample(id)
      instance_double(
        Sample,
        id: id,
        name: "Sample #{id}",
        initial_workflow: WorkflowRun::WORKFLOW[:short_read_mngs],
        metadata_with_base_type: {},
        host_genome_name: "Human"
      )
    end

    let(:taxon_row) do
      {
        "tax_id" => 100,
        "tax_level" => 1,
        "genus_taxid" => 50,
        "NT" => { "zscore" => 1.0, "rpm" => 5.0 },
        "NR" => { "zscore" => 1.0, "rpm" => 4.0 },
      }
    end

    before do
      allow(ReportHelper).to receive(:taxon_counts_cleanup).and_return(1 => taxon_row)
    end

    it "reports the alignment config name when the pipeline run has one" do
      sample = build_sample(11)
      alignment_config = instance_double(AlignmentConfig, name: "2021-01-22")
      pr = instance_double(PipelineRun, sample_id: 11, pipeline_version: "6.10",
                                        alignment_config: alignment_config, total_ercc_reads: 42)

      results = HeatmapHelper.samples_taxons_details({ 1 => { "pr" => pr, "taxon_counts" => [] } }, [sample], [100], [])

      expect(results.first[:alignment_config_name]).to eq("2021-01-22")
      expect(results.first[:ercc_count]).to eq(42)
    end

    it "reports a nil alignment config name when the pipeline run has none" do
      sample = build_sample(12)
      pr = instance_double(PipelineRun, sample_id: 12, pipeline_version: "6.10",
                                        alignment_config: nil, total_ercc_reads: nil)

      results = HeatmapHelper.samples_taxons_details({ 1 => { "pr" => pr, "taxon_counts" => [] } }, [sample], [100], [])

      expect(results.first[:alignment_config_name]).to be_nil
    end
  end

  describe ".fetch_samples_taxons_counts row folding" do
    def stub_query(rows)
      allow(HeatmapHelper).to receive(:get_latest_pipeline_runs_for_samples).and_return(500 => 11)
      allow(HeatmapHelper).to receive(:samples_taxons_counts_query).and_return(rows)
    end

    let(:pipeline_run) { instance_double(PipelineRun, id: 500, total_reads: 1000, total_ercc_reads: 100) }

    before do
      allow(pipeline_run).to receive(:rpm, &:to_f)
      allow(PipelineRun).to receive(:where).and_return(double(includes: [pipeline_run]))
    end

    it "folds a second row into the pipeline run entry already in the hash" do
      stub_query([
                   { "pipeline_run_id" => 500, "r" => 10.0, "mean" => 1.0, "stdev" => 1.0, "mean_mass_normalized" => nil, "stdev_mass_normalized" => nil },
                   { "pipeline_run_id" => 500, "r" => 20.0, "mean" => 1.0, "stdev" => 1.0, "mean_mass_normalized" => nil, "stdev_mass_normalized" => nil },
                 ])

      result = HeatmapHelper.fetch_samples_taxons_counts([instance_double(Sample)], [100], [], 7)

      expect(result.keys).to eq([500])
      expect(result[500]["taxon_counts"].length).to eq(2)
    end

    it "uses the mass-normalized zscore when the background provides one" do
      stub_query([
                   { "pipeline_run_id" => 500, "r" => 10.0, "mean" => 1.0, "stdev" => 1.0,
                     "mean_mass_normalized" => 0.05, "stdev_mass_normalized" => 0.01, },
                 ])

      result = HeatmapHelper.fetch_samples_taxons_counts([instance_double(Sample)], [100], [], 7)

      # (10/100 - 0.05) / 0.01 = 5.0
      expect(result[500]["taxon_counts"].first["zscore"]).to eq(5.0)
    end

    it "clamps a very negative zscore to ZSCORE_MIN" do
      stub_query([
                   { "pipeline_run_id" => 500, "r" => 1.0, "mean" => 100_000.0, "stdev" => 1.0,
                     "mean_mass_normalized" => nil, "stdev_mass_normalized" => nil, },
                 ])

      result = HeatmapHelper.fetch_samples_taxons_counts([instance_double(Sample)], [100], [], 7)

      expect(result[500]["taxon_counts"].first["zscore"]).to eq(ReportHelper::ZSCORE_MIN)
    end
  end
end

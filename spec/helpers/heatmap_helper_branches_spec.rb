require "rails_helper"

# Branch-coverage companion for app/helpers/heatmap_helper.rb.
# heatmap_helper_coverage_spec.rb drives the data-shaping paths; this file takes
# the parameter-parsing arms of sample_taxons_dict (minReads, sortBy, species,
# each `presets` guard in both directions) plus the "score did not improve" arm
# of top_taxons_details and the empty-parent_ids arm of fetch_samples_taxons_counts.
RSpec.describe HeatmapHelper, type: :helper do
  let(:sample) { instance_double(Sample, default_background_id: 9) }

  # Capture the keyword arguments TopTaxonsSqlService receives so each param
  # branch can be asserted on the value that actually reaches the query layer.
  def run_dict(**params)
    background_id = params.delete(:background_id) || 4
    captured = nil
    allow(TopTaxonsSqlService).to receive(:call) do |_samples, _bg, kwargs|
      captured = kwargs
      {}
    end
    allow(HeatmapHelper).to receive(:top_taxons_details).and_return([])
    allow(HeatmapHelper).to receive(:samples_taxons_details).and_return([])

    HeatmapHelper.sample_taxons_dict(params, [sample], background_id)
    captured
  end

  describe ".sample_taxons_dict parameter parsing" do
    it "returns an empty hash when there are no samples" do
      expect(HeatmapHelper.sample_taxons_dict({ thresholdFilters: "[]" }, [], 4)).to eq({})
    end

    it "uses the supplied minReads when present" do
      captured = run_dict(minReads: "42", thresholdFilters: "[]")
      expect(captured[:min_reads]).to eq(42)
    end

    it "falls back to MINIMUM_READ_THRESHOLD when minReads is absent" do
      captured = run_dict(thresholdFilters: "[]")
      expect(captured[:min_reads]).to eq(HeatmapHelper::MINIMUM_READ_THRESHOLD)
    end

    it "parses a JSON-string thresholdFilters payload" do
      captured = run_dict(thresholdFilters: '[{"metric":"NT_rpm","value":"5","operator":">="}]')
      expect(captured[:threshold_filters]).to eq([{ "metric" => "NT_rpm", "value" => "5", "operator" => ">=" }])
    end

    it "parses an array-of-JSON-strings thresholdFilters payload" do
      captured = run_dict(thresholdFilters: ['{"metric":"NR_zscore","value":"1","operator":"<="}'])
      expect(captured[:threshold_filters]).to eq([{ "metric" => "NR_zscore", "value" => "1", "operator" => "<=" }])
    end

    it "keeps the supplied background when it is positive" do
      captured = nil
      allow(TopTaxonsSqlService).to receive(:call) do |_samples, bg, _kwargs|
        captured = bg
        {}
      end
      allow(HeatmapHelper).to receive(:top_taxons_details).and_return([])
      allow(HeatmapHelper).to receive(:samples_taxons_details).and_return([])

      HeatmapHelper.sample_taxons_dict({ thresholdFilters: "[]" }, [sample], 77)
      expect(captured).to eq(77)
    end

    it "falls back to the sample's default background when the id is not positive" do
      captured = nil
      allow(TopTaxonsSqlService).to receive(:call) do |_samples, bg, _kwargs|
        captured = bg
        {}
      end
      allow(HeatmapHelper).to receive(:top_taxons_details).and_return([])
      allow(HeatmapHelper).to receive(:samples_taxons_details).and_return([])

      HeatmapHelper.sample_taxons_dict({ thresholdFilters: "[]" }, [sample], nil)
      expect(captured).to eq(9)
    end

    it "leaves every preset-driven filter nil when no presets are supplied" do
      captured = run_dict(thresholdFilters: "[]", categories: ["viruses"], readSpecificity: "1")

      expect(captured[:categories]).to be_nil
      expect(captured[:include_phage]).to be_nil
      expect(captured[:read_specificity]).to be_nil
      expect(captured[:taxon_level]).to be_nil
    end

    it "applies only the presets that are listed" do
      captured = run_dict(
        thresholdFilters: "[]",
        presets: ["categories"],
        categories: ["viruses"],
        subcategories: '{"Viruses":["Phage"]}',
        species: "1",
        readSpecificity: "1"
      )

      expect(captured[:categories]).to eq(["viruses"])
      # subcategories / species / readSpecificity are not in the presets list.
      expect(captured[:include_phage]).to be_nil
      expect(captured[:taxon_level]).to be_nil
      expect(captured[:read_specificity]).to be_nil
    end

    it "resolves include_phage to false when the subcategories omit Phage" do
      captured = run_dict(
        thresholdFilters: "[]",
        presets: ["subcategories"],
        subcategories: '{"Viruses":["Non-phage"]}'
      )

      expect(captured[:include_phage]).to be(false)
    end

    it "resolves include_phage to nil when the subcategories have no Viruses key" do
      captured = run_dict(
        thresholdFilters: "[]",
        presets: ["subcategories"],
        subcategories: '{"Bacteria":["Something"]}'
      )

      expect(captured[:include_phage]).to be_nil
    end

    it "selects the genus taxon level when the species preset is not species" do
      captured = run_dict(thresholdFilters: "[]", presets: ["species"], species: "0")
      expect(captured[:taxon_level]).to eq(TaxonCount::TAX_LEVEL_GENUS)
    end

    it "honors a valid sortBy and falls back to the default for an invalid one" do
      valid = nil
      invalid = nil
      allow(HeatmapHelper).to receive(:top_taxons_details) do |_results, sort_by, _workflow|
        valid.nil? ? (valid = sort_by) : (invalid = sort_by)
        []
      end
      allow(TopTaxonsSqlService).to receive(:call).and_return({})
      allow(HeatmapHelper).to receive(:samples_taxons_details).and_return([])

      HeatmapHelper.sample_taxons_dict({ thresholdFilters: "[]", sortBy: "NT.rpm" }, [sample], 4)
      HeatmapHelper.sample_taxons_dict({ thresholdFilters: "[]", sortBy: "not_a_metric" }, [sample], 4)

      expect(invalid).to eq(HeatmapHelper::DEFAULT_TAXON_SORT_PARAM)
      expect(valid).not_to eq(HeatmapHelper::DEFAULT_TAXON_SORT_PARAM)
    end

    it "refetches with no parent ids when species is selected" do
      allow(TopTaxonsSqlService).to receive(:call).and_return({})
      allow(HeatmapHelper).to receive(:top_taxons_details).and_return(
        [{ "tax_id" => 100, "genus_taxid" => 50 }]
      )
      allow(HeatmapHelper).to receive(:fetch_samples_taxons_counts).and_return({})
      allow(HeatmapHelper).to receive(:samples_taxons_details).and_return([])

      HeatmapHelper.sample_taxons_dict({ thresholdFilters: "[]", species: "1" }, [sample], 4)

      expect(HeatmapHelper).to have_received(:fetch_samples_taxons_counts)
        .with([sample], [100], [], 4)
    end

    it "does not refetch when every candidate taxon was removed" do
      allow(TopTaxonsSqlService).to receive(:call).and_return({})
      allow(HeatmapHelper).to receive(:top_taxons_details).and_return(
        [{ "tax_id" => 100, "genus_taxid" => 50 }]
      )
      allow(HeatmapHelper).to receive(:fetch_samples_taxons_counts).and_return({})
      allow(HeatmapHelper).to receive(:samples_taxons_details).and_return([])

      HeatmapHelper.sample_taxons_dict({ thresholdFilters: "[]", removedTaxonIds: ["100"] }, [sample], 4)

      expect(HeatmapHelper).not_to have_received(:fetch_samples_taxons_counts)
    end
  end

  describe ".top_taxons_details max_aggregate_score" do
    def taxon_row(tax_id:, nt_rpm:)
      {
        "tax_id" => tax_id,
        "genus_taxid" => 50,
        "tax_level" => 1,
        "NT" => { "rpm" => nt_rpm, "zscore" => 1.0 },
        "NR" => { "rpm" => 1.0, "zscore" => 1.0 },
      }
    end

    it "keeps the higher score when a later pipeline run scores lower for the same taxon" do
      pr_high = instance_double(PipelineRun, sample_id: 1)
      pr_low = instance_double(PipelineRun, sample_id: 2)
      allow(ReportHelper).to receive(:taxon_counts_cleanup) do |taxon_counts, _workflow|
        { 1 => taxon_row(tax_id: 100, nt_rpm: taxon_counts.first) }
      end

      results_by_pr = {
        1 => { "pr" => pr_high, "taxon_counts" => [9.0] },
        2 => { "pr" => pr_low, "taxon_counts" => [2.0] },
      }

      details = HeatmapHelper.top_taxons_details(results_by_pr, "highest_nt_rpm", WorkflowRun::WORKFLOW[:short_read_mngs])

      expect(details.length).to eq(1)
      expect(details.first["max_aggregate_score"]).to eq(9.0)
      # Both samples still contribute their per-sample tuple.
      expect(details.first["samples"].keys).to match_array([1, 2])
    end

    it "raises the score when a later pipeline run scores higher for the same taxon" do
      pr_low = instance_double(PipelineRun, sample_id: 1)
      pr_high = instance_double(PipelineRun, sample_id: 2)
      allow(ReportHelper).to receive(:taxon_counts_cleanup) do |taxon_counts, _workflow|
        { 1 => taxon_row(tax_id: 100, nt_rpm: taxon_counts.first) }
      end

      results_by_pr = {
        1 => { "pr" => pr_low, "taxon_counts" => [2.0] },
        2 => { "pr" => pr_high, "taxon_counts" => [9.0] },
      }

      details = HeatmapHelper.top_taxons_details(results_by_pr, "highest_nt_rpm", WorkflowRun::WORKFLOW[:short_read_mngs])

      expect(details.first["max_aggregate_score"]).to eq(9.0)
    end
  end

  describe ".fetch_samples_taxons_counts parent_ids clause" do
    it "builds an empty parent clause when no parent ids are given" do
      allow(HeatmapHelper).to receive(:get_latest_pipeline_runs_for_samples).and_return({ 500 => 11 })
      allow(PipelineRun).to receive(:where).and_return(double(includes: []))
      captured_clause = :unset
      allow(HeatmapHelper).to receive(:samples_taxons_counts_query) do |_bg, _map, _taxa, clause|
        captured_clause = clause
        []
      end

      HeatmapHelper.fetch_samples_taxons_counts([instance_double(Sample)], [100], [], 7)

      expect(captured_clause).to eq("")
    end
  end

  describe ".apply_custom_filters operator handling" do
    let(:row) { { "NT" => { "rpm" => 10 }, "NR" => { "zscore" => 3 } } }

    it "passes a row that satisfies every filter in a multi-filter set" do
      filters = [
        { "metric" => "NT_rpm", "value" => "5", "operator" => ">=" },
        { "metric" => "NR_zscore", "value" => "5", "operator" => "<=" },
      ]
      expect(HeatmapHelper.apply_custom_filters(row, filters)).to be true
    end

    it "fails the row as soon as one filter in the set rejects it" do
      filters = [
        { "metric" => "NT_rpm", "value" => "5", "operator" => ">=" },
        { "metric" => "NR_zscore", "value" => "1", "operator" => "<=" },
      ]
      expect(HeatmapHelper.apply_custom_filters(row, filters)).to be false
    end
  end
end

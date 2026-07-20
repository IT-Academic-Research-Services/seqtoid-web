require "rails_helper"

# Branch sweep for the pure/static methods of BulkDownloadsHelper, which had no
# dedicated spec. Focuses on the class methods whose branches can be exercised
# without the database: the zscore operator matrix, metric-string parsing, the
# category/count-type/threshold early-returns, the tsv-row nil guard, the
# metric-inclusion rule in generate_metric_values, and the CG metrics
# present/empty arms. Every example flips a single branch. Spec-only.
RSpec.describe BulkDownloadsHelper, type: :helper do
  describe ".filter_zscore operator matrix" do
    it "passes a value that satisfies every >= / <= bound (all? true)" do
      filters = [
        { operator: ">=", value: "1" },
        { operator: "<=", value: "10" },
      ]
      expect(BulkDownloadsHelper.filter_zscore(filters, 5)).to be(true)
    end

    it "fails when the value violates a >= bound (all? false)" do
      filters = [{ operator: ">=", value: "10" }]
      expect(BulkDownloadsHelper.filter_zscore(filters, 5)).to be(false)
    end

    it "fails when the value violates a <= bound (all? false)" do
      filters = [{ operator: "<=", value: "1" }]
      expect(BulkDownloadsHelper.filter_zscore(filters, 5)).to be(false)
    end

    it "raises the invalid-operator error for an unrecognized operator" do
      filters = [{ operator: "!!", value: "1" }]
      expect { BulkDownloadsHelper.filter_zscore(filters, 5) }
        .to raise_error(BulkDownloadsHelper::INVALID_OPERATOR_ERROR)
    end

    it "returns true for an empty filter set (vacuously all?)" do
      expect(BulkDownloadsHelper.filter_zscore([], 5)).to be(true)
    end
  end

  describe ".parse_metric_string separator arms" do
    it "splits on an underscore into count_type and mapped metric" do
      expect(BulkDownloadsHelper.parse_metric_string("NT_rpm")).to eq(["NT", "rpm"])
    end

    it "splits on a dot into count_type and mapped metric" do
      # zscore maps to the DB column name z_score via METRIC_MAP.
      expect(BulkDownloadsHelper.parse_metric_string("NR.zscore")).to eq(["NR", "z_score"])
    end

    it "maps percentidentity to percent_identity" do
      expect(BulkDownloadsHelper.parse_metric_string("NT_percentidentity")).to eq(["NT", "percent_identity"])
    end

    it "degrades to [nil, nil] for a string with neither separator (was a NoMethodError)" do
      # No "_" or "." -> both branches skipped -> metric_fe nil. The guard must return [nil, nil]
      # instead of calling nil.to_sym. Removing the guard makes this raise NoMethodError.
      expect(BulkDownloadsHelper.parse_metric_string("bogus")).to eq([nil, nil])
    end
  end

  describe ".parse_filters" do
    it "maps each filter's metric string, coerces the value to Float, and keeps the operator" do
      parsed = BulkDownloadsHelper.parse_filters([{ "metric" => "NT_rpm", "value" => "3.5", "operator" => ">=" }])
      expect(parsed).to eq([{ metric: "rpm", value: 3.5, operator: ">=", count_type: "NT" }])
    end
  end

  describe ".filter_by_category early-return arm" do
    it "returns the relation untouched when categories are blank" do
      relation = Object.new
      expect(BulkDownloadsHelper.filter_by_category(nil, relation)).to equal(relation)
    end

    it "scopes by the mapped superkingdom taxids when categories are present" do
      relation = double("relation")
      scoped = Object.new
      expected_taxids = ["Viruses"].map { |c| ReportHelper::CATEGORIES_TAXID_BY_NAME[c] }
      expect(relation).to receive(:where).with(superkingdom_taxid: expected_taxids).and_return(scoped)
      expect(BulkDownloadsHelper.filter_by_category(["Viruses"], relation)).to equal(scoped)
    end
  end

  describe ".filter_by_count_type guard" do
    it "returns the relation untouched for a non NT/NR count type" do
      relation = Object.new
      expect(BulkDownloadsHelper.filter_by_count_type("XX", relation)).to equal(relation)
    end

    it "scopes to the count_type for NT" do
      relation = double("relation")
      scoped = Object.new
      expect(relation).to receive(:where).with(count_type: "NT").and_return(scoped)
      expect(BulkDownloadsHelper.filter_by_count_type("NT", relation)).to equal(scoped)
    end
  end

  describe ".filter_by_threshold blank-filters arm" do
    it "returns the relation and an empty zscore list when filters are blank" do
      relation = Object.new
      expect(BulkDownloadsHelper.filter_by_threshold(nil, relation)).to eq([relation, []])
    end
  end

  describe ".output_tsv_row nil guard" do
    it "does nothing when prev_taxon_count is nil" do
      tsv = []
      taxonomy_tsv = []
      expect(BulkDownloadsHelper.output_tsv_row(tsv, taxonomy_tsv, [1, 2], nil)).to be_nil
      expect(tsv).to be_empty
      expect(taxonomy_tsv).to be_empty
    end

    it "appends the joined taxonomy id plus metrics when prev_taxon_count is present" do
      tsv = []
      taxonomy_tsv = []
      prev = BulkDownloadsHelper::TAXONOMY_LIST.index_with { |level| level.sub("_name", "") }
      BulkDownloadsHelper.output_tsv_row(tsv, taxonomy_tsv, [7, 8], prev)

      uniq_id = BulkDownloadsHelper::TAXONOMY_LIST.map { |lvl| prev[lvl] }.join(";")
      expect(tsv.first).to eq([uniq_id, 7, 8])
      # taxonomy row drops the first (superkingdom) level then re-prepends the id.
      expect(taxonomy_tsv.first.first).to eq(uniq_id)
      expect(taxonomy_tsv.first.length).to eq(BulkDownloadsHelper::TAXONOMY_LIST.length)
    end
  end

  describe ".generate_metric_values inclusion rule" do
    let(:sample) { instance_double("Sample", id: 42, initial_workflow: "short_read_mngs") }

    before do
      # Bypass the human-read cleanup; return the counts hash unchanged so the
      # species-filter + inclusion rule run on our fixture.
      allow(ReportHelper).to receive(:taxon_counts_cleanup) { |counts, _wf| counts }
    end

    it "includes positive rpm values (and records the taxon name) but drops zero rpm" do
      counts = {
        101 => { "NT" => { "rpm" => 5.0 }, "tax_level" => TaxonCount::TAX_LEVEL_SPECIES, "name" => "Bug A" },
        102 => { "NT" => { "rpm" => 0.0 }, "tax_level" => TaxonCount::TAX_LEVEL_SPECIES, "name" => "Bug B" },
      }
      result = BulkDownloadsHelper.generate_metric_values(
        { "pr1" => { "taxon_counts" => counts, "sample_id" => 42 } }, [sample], "NT.rpm"
      )
      expect(result[:metric_values][42]).to eq(101 => 5.0)
      expect(result[:taxids_to_name]).to eq(101 => "Bug A")
    end

    it "includes a zero value when the metric is a zscore (zscore inclusion clause)" do
      counts = {
        201 => { "NT" => { "zscore" => 0.0 }, "tax_level" => TaxonCount::TAX_LEVEL_SPECIES, "name" => "Bug C" },
      }
      result = BulkDownloadsHelper.generate_metric_values(
        { "pr1" => { "taxon_counts" => counts, "sample_id" => 42 } }, [sample], "NT.zscore"
      )
      expect(result[:metric_values][42]).to eq(201 => 0.0)
    end
  end

  describe ".prepare_workflow_run_metrics_csv_info present/empty arms" do
    it "returns a blank-filled row when there are no cached results" do
      wr = instance_double("WorkflowRun", parsed_cached_results: nil)
      row = BulkDownloadsHelper.prepare_workflow_run_metrics_csv_info(workflow_run: wr)
      expect(row.length).to eq(ConsensusGenomeMetricsService::ALL_METRICS.keys.length)
      expect(row).to all(eq(""))
    end

    it "returns the metric values ordered by ALL_METRICS when quality metrics are present" do
      wr = instance_double(
        "WorkflowRun",
        parsed_cached_results: { "quality_metrics" => { "total_reads" => 999 } }
      )
      row = BulkDownloadsHelper.prepare_workflow_run_metrics_csv_info(workflow_run: wr)
      expect(row.length).to eq(ConsensusGenomeMetricsService::ALL_METRICS.keys.length)
      # total_reads is a real ALL_METRICS key, so its value threads through;
      # absent keys fall back to the Hash default "".
      expect(row).to include(999)
      expect(row).to include("")
    end
  end
end

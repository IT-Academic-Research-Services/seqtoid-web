# frozen_string_literal: true

require "rails_helper"

# Coverage Wave: branch sweep for TopTaxonsSqlService. The main spec only ever
# calls the service end-to-end with default filter options on a short-read and a
# long-read sample, so almost every SQL-clause builder is exercised down a single
# arm. This spec drives the untaken arms of each clause builder plus the ranking
# helper and the result organiser:
#
#   - #initialize: the samples.nil? guard
#   - #select_sql_clause / #join_background_sql_clause / #count_per_million_sql:
#     the short-read arm, the long-read arm, and (where reachable) the fall-through
#   - #category_sql_clause: categories-present, include_phage-only, neither
#   - #phage_sql_clause: all four combinations of include_phage x categories
#   - #read_specificity_sql_clause: both arms
#   - #tax_level_sql_clause: nil / species / genus / unrecognised level
#   - #top_n_query: threshold-filters early return, count_type present/absent,
#     and the highest/lowest sort-direction ternary
#   - #organize_taxons_by_pr_id: first-row vs repeat-row branch, the
#     include_taxon_counts && short/long guard, and both zscore clamps
RSpec.describe TopTaxonsSqlService, type: :service do
  let(:short_read) { WorkflowRun::WORKFLOW[:short_read_mngs] }
  let(:long_read) { WorkflowRun::WORKFLOW[:long_read_mngs] }

  # Build an instance without running the DB-backed initializer so each clause
  # builder can be driven independently.
  def build(workflow:, categories: [], include_phage: false, read_specificity: false,
            taxon_level: nil, background_id: 123, pr_id_to_sample_id: {})
    service = described_class.allocate
    service.instance_variable_set(:@workflow, workflow)
    service.instance_variable_set(:@categories, categories)
    service.instance_variable_set(:@include_phage, include_phage)
    service.instance_variable_set(:@read_specificity, read_specificity)
    service.instance_variable_set(:@taxon_level, taxon_level)
    service.instance_variable_set(:@background_id, background_id)
    service.instance_variable_set(:@pr_id_to_sample_id, pr_id_to_sample_id)
    service
  end

  describe "#initialize" do
    it "warns and treats nil samples as an empty list (the samples.nil? then-arm)" do
      expect(Rails.logger).to receive(:warn).with("TopTaxonsSqlService call with samples = nil")
      # With no samples there is no workflow to read, so the empty list blows up on
      # the very next line -- the warning is the observable effect of the guard.
      expect { described_class.new(nil, 1) }.to raise_error(NoMethodError)
    end
  end

  describe "#select_sql_clause" do
    it "selects background columns and a zscore for short-read (the if-arm)" do
      clause = build(workflow: short_read).send(:select_sql_clause)
      expect(clause).to include("stdev_mass_normalized")
      expect(clause).to include("AS zscore")
      expect(clause).to include("AS rpm")
      expect(clause).not_to include("base_count")
    end

    it "selects base_count and a bpm, with no background columns, for long-read (the elsif-arm)" do
      clause = build(workflow: long_read).send(:select_sql_clause)
      expect(clause).to include("base_count               AS  b")
      expect(clause).to include("AS bpm")
      expect(clause).not_to include("stdev")
      expect(clause).not_to include("zscore")
    end
  end

  describe "#join_background_sql_clause" do
    it "joins taxon_summaries on the configured background for short-read (the if-arm)" do
      clause = build(workflow: short_read, background_id: 77).send(:join_background_sql_clause)
      expect(clause).to include("LEFT OUTER JOIN taxon_summaries")
      expect(clause).to include("77  = taxon_summaries.background_id")
    end

    it "returns nil for long-read, which has no background support (the untaken arm)" do
      expect(build(workflow: long_read).send(:join_background_sql_clause)).to be_nil
    end
  end

  describe "#count_per_million_sql" do
    it "builds the reads-per-million expression for short-read" do
      expect(build(workflow: short_read).send(:count_per_million_sql)).to include("total_ercc_reads")
    end

    it "builds the bases-per-million expression for long-read" do
      sql = build(workflow: long_read).send(:count_per_million_sql)
      expect(sql).to include("base_count")
      expect(sql).to include("fraction_subsampled_bases")
    end
  end

  describe "#category_sql_clause" do
    it "filters by the mapped superkingdom taxids when categories are given (the if-arm)" do
      clause = build(workflow: short_read, categories: ["Bacteria", "Viruses"]).send(:category_sql_clause)
      expected = [ReportHelper::CATEGORIES_TAXID_BY_NAME["Bacteria"], ReportHelper::CATEGORIES_TAXID_BY_NAME["Viruses"]]
      expect(clause).to eq(" AND taxon_counts.superkingdom_taxid IN (#{expected.join(',')})")
    end

    it "drops unknown category names rather than emitting a NULL taxid" do
      clause = build(workflow: short_read, categories: ["Bacteria", "Not A Category"]).send(:category_sql_clause)
      expect(clause).to eq(" AND taxon_counts.superkingdom_taxid IN (#{ReportHelper::CATEGORIES_TAXID_BY_NAME['Bacteria']})")
    end

    it "falls back to the Viruses superkingdom when only phage is selected (the elsif-arm)" do
      clause = build(workflow: short_read, categories: [], include_phage: true).send(:category_sql_clause)
      expect(clause).to eq(" AND taxon_counts.superkingdom_taxid = #{ReportHelper::CATEGORIES_TAXID_BY_NAME['Viruses']}")
    end

    it "returns nil when neither categories nor phage are selected (the untaken arm)" do
      expect(build(workflow: short_read).send(:category_sql_clause)).to be_nil
    end
  end

  describe "#phage_sql_clause" do
    it "explicitly excludes phages when categories are selected without phage (the if-arm)" do
      clause = build(workflow: short_read, categories: ["Bacteria"], include_phage: false).send(:phage_sql_clause)
      expect(clause).to eq(" AND taxon_counts.is_phage != 1")
    end

    it "fetches only phages when phage is selected with no categories (the elsif-arm)" do
      clause = build(workflow: short_read, categories: [], include_phage: true).send(:phage_sql_clause)
      expect(clause).to eq(" AND taxon_counts.is_phage = 1")
    end

    it "returns nil when phage is selected alongside categories (both conditions false)" do
      expect(build(workflow: short_read, categories: ["Bacteria"], include_phage: true).send(:phage_sql_clause)).to be_nil
    end

    it "returns nil when neither phage nor categories are selected" do
      expect(build(workflow: short_read, categories: [], include_phage: false).send(:phage_sql_clause)).to be_nil
    end
  end

  describe "#read_specificity_sql_clause" do
    it "restricts to positive tax ids when read specificity is on (the if-arm)" do
      expect(build(workflow: short_read, read_specificity: true).send(:read_specificity_sql_clause))
        .to eq(" AND taxon_counts.tax_id > 0")
    end

    it "returns nil when read specificity is off (the untaken arm)" do
      expect(build(workflow: short_read, read_specificity: false).send(:read_specificity_sql_clause)).to be_nil
    end
  end

  describe "#tax_level_sql_clause" do
    it "allows both species and genus when no level is requested (the outer if not taken)" do
      clause = build(workflow: short_read, taxon_level: nil).send(:tax_level_sql_clause)
      expect(clause).to eq(" AND taxon_counts.tax_level IN ('#{TaxonCount::TAX_LEVEL_SPECIES}', '#{TaxonCount::TAX_LEVEL_GENUS}')")
    end

    it "narrows to species when the species level is requested (the inner if-arm)" do
      clause = build(workflow: short_read, taxon_level: TaxonCount::TAX_LEVEL_SPECIES).send(:tax_level_sql_clause)
      expect(clause).to eq(" AND taxon_counts.tax_level IN ('#{TaxonCount::TAX_LEVEL_SPECIES}')")
    end

    it "narrows to genus when the genus level is requested (the inner elsif-arm)" do
      clause = build(workflow: short_read, taxon_level: TaxonCount::TAX_LEVEL_GENUS).send(:tax_level_sql_clause)
      expect(clause).to eq(" AND taxon_counts.tax_level IN ('#{TaxonCount::TAX_LEVEL_GENUS}')")
    end

    it "keeps the default clause for an unrecognised level (the inner else fall-through)" do
      clause = build(workflow: short_read, taxon_level: 99).send(:tax_level_sql_clause)
      expect(clause).to eq(" AND taxon_counts.tax_level IN ('#{TaxonCount::TAX_LEVEL_SPECIES}', '#{TaxonCount::TAX_LEVEL_GENUS}')")
    end
  end

  describe "#top_n_query" do
    let(:service) { build(workflow: short_read) }
    let(:inner) { "SELECT 1" }

    it "returns the query unchanged when threshold filters are present (the early return)" do
      result = service.send(:top_n_query, inner, 10, "rpm", "highest", threshold_filters: [{ metric: "NT_zscore" }])
      expect(result).to eq(inner)
    end

    it "wraps the query in a ROW_NUMBER window when there are no threshold filters" do
      result = service.send(:top_n_query, inner, 10, "rpm", "highest", threshold_filters: [])
      expect(result).to include("ROW_NUMBER() OVER (")
      expect(result).to include("PARTITION BY pipeline_run_id")
      expect(result).to include("WHERE `rank` <= 10")
    end

    it "orders DESC for the 'highest' direction (the ternary then-arm)" do
      result = service.send(:top_n_query, inner, 5, "rpm", "highest")
      expect(result).to include("rpm DESC")
    end

    it "orders ASC for any other direction (the ternary else-arm)" do
      result = service.send(:top_n_query, inner, 5, "rpm", "lowest")
      expect(result).to include("rpm ASC")
    end

    it "prepends a count_type tiebreaker when count_type is given (the ternary then-arm)" do
      result = service.send(:top_n_query, inner, 5, "rpm", "highest", count_type: "NT")
      expect(result).to include("count_type = 'NT' DESC,")
    end

    it "omits the count_type tiebreaker when count_type is nil (the ternary else-arm)" do
      result = service.send(:top_n_query, inner, 5, "rpm", "highest", count_type: nil)
      expect(result).not_to include("count_type =")
    end
  end

  describe "#organize_taxons_by_pr_id" do
    let(:project) { create(:project) }

    def row(pr_id, zscore: 1.0, tax_id: 570)
      { "pipeline_run_id" => pr_id, "tax_id" => tax_id, "zscore" => zscore }
    end

    context "short-read" do
      let!(:sample) { create(:sample, project: project, initial_workflow: WorkflowRun::WORKFLOW[:short_read_mngs]) }
      let!(:pipeline_run) { create(:pipeline_run, sample: sample, total_reads: 1000) }

      it "creates the bucket on the first row and reuses it on later rows" do
        service = build(workflow: short_read, pr_id_to_sample_id: { pipeline_run.id => sample.id })
        result = service.send(:organize_taxons_by_pr_id, [row(pipeline_run.id, tax_id: 1), row(pipeline_run.id, tax_id: 2)])

        expect(result.keys).to eq([pipeline_run.id])
        expect(result[pipeline_run.id]["pr"]).to eq(pipeline_run)
        expect(result[pipeline_run.id]["sample_id"]).to eq(sample.id)
        expect(result[pipeline_run.id]["taxon_counts"].length).to eq(2)
      end

      it "clamps a zscore above the max down to ZSCORE_MAX" do
        service = build(workflow: short_read, pr_id_to_sample_id: { pipeline_run.id => sample.id })
        result = service.send(:organize_taxons_by_pr_id, [row(pipeline_run.id, zscore: 500.0)])
        expect(result[pipeline_run.id]["taxon_counts"].first["zscore"]).to eq(ReportHelper::ZSCORE_MAX)
      end

      it "leaves the absent-from-background sentinel unclamped (the second && operand)" do
        service = build(workflow: short_read, pr_id_to_sample_id: { pipeline_run.id => sample.id })
        sentinel = ReportHelper::ZSCORE_WHEN_ABSENT_FROM_BACKGROUND
        result = service.send(:organize_taxons_by_pr_id, [row(pipeline_run.id, zscore: sentinel)])
        expect(result[pipeline_run.id]["taxon_counts"].first["zscore"]).to eq(sentinel)
      end

      it "clamps a zscore below the min up to ZSCORE_MIN" do
        service = build(workflow: short_read, pr_id_to_sample_id: { pipeline_run.id => sample.id })
        result = service.send(:organize_taxons_by_pr_id, [row(pipeline_run.id, zscore: -500.0)])
        expect(result[pipeline_run.id]["taxon_counts"].first["zscore"]).to eq(ReportHelper::ZSCORE_MIN)
      end

      it "leaves an in-range zscore alone (neither clamp taken)" do
        service = build(workflow: short_read, pr_id_to_sample_id: { pipeline_run.id => sample.id })
        result = service.send(:organize_taxons_by_pr_id, [row(pipeline_run.id, zscore: 3.5)])
        expect(result[pipeline_run.id]["taxon_counts"].first["zscore"]).to eq(3.5)
      end
    end

    context "when the run has no counts to include" do
      let!(:sample) { create(:sample, project: project, initial_workflow: WorkflowRun::WORKFLOW[:short_read_mngs]) }
      let!(:pipeline_run) { create(:pipeline_run, sample: sample, total_reads: nil) }

      it "still records the pipeline run bucket but skips the taxon counts (include_taxon_counts false)" do
        service = build(workflow: short_read, pr_id_to_sample_id: { pipeline_run.id => sample.id })
        result = service.send(:organize_taxons_by_pr_id, [row(pipeline_run.id, zscore: 500.0)])

        expect(result[pipeline_run.id]["taxon_counts"]).to eq([])
      end
    end

    context "long-read" do
      let!(:sample) { create(:sample, project: project, initial_workflow: WorkflowRun::WORKFLOW[:long_read_mngs]) }
      let!(:pipeline_run) { create(:pipeline_run, sample: sample, total_bases: 5000) }

      it "includes rows without touching the zscore clamps (the short-read inner if not taken)" do
        service = build(workflow: long_read, pr_id_to_sample_id: { pipeline_run.id => sample.id })
        result = service.send(:organize_taxons_by_pr_id, [row(pipeline_run.id, zscore: 500.0)])

        expect(result[pipeline_run.id]["taxon_counts"].length).to eq(1)
        expect(result[pipeline_run.id]["taxon_counts"].first["zscore"]).to eq(500.0)
      end
    end
  end
end

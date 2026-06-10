require 'rails_helper'

# Parity spec for the bug-#010 rewrite of the top-N-per-pipeline-run ranking
# from a MySQL session-variable trick (@rank := IF(@current_id = ...)) to a
# portable ROW_NUMBER() OVER (PARTITION BY pipeline_run_id ORDER BY ...) window
# function (PostgreSQL / MySQL 8+).
#
# These assertions encode the ranking CONTRACT and must hold identically before
# and after the rewrite, and on either database engine — they intentionally do
# not depend on the exact computed rpm/zscore values:
#   1) Ranks reset to 1 for each pipeline run (this is exactly what the old
#      @current_id reset did, and the part most prone to the documented session-
#      variable bug — so it's the heart of the parity guarantee).
#   2) Within a pipeline run, ranks are unique and contiguous starting at 1.
#   3) The number of returned rows per run never exceeds taxa_per_sample.
RSpec.describe TopTaxonsSqlService, "ranking parity (bug-#010)", type: :service do
  let(:mock_background_id) { 123 }
  let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }

  # Same shape the existing service spec uses (NT + NR rows across two tax levels).
  def taxon_counts_data
    [
      { tax_level: 1, taxon_name: "Klebsiella pneumoniae", nt: 209, percent_identity: 99.6995, alignment_length: 149.402, e_value: -89.5641 },
      { tax_level: 1, taxon_name: "Klebsiella pneumoniae", nr: 69, percent_identity: 97.8565, alignment_length: 46.3623, e_value: -16.9101 },
      { tax_level: 2, taxon_name: "Klebsiella", nt: 217, percent_identity: 99.7014, alignment_length: 149.424, e_value: -89.5822 },
      { tax_level: 2, taxon_name: "Klebsiella", nr: 87, percent_identity: 97.9598, alignment_length: 46.4253, e_value: -16.9874 },
    ]
  end

  before do
    create(:taxon_lineage, tax_name: "Klebsiella pneumoniae", taxid: 573, genus_taxid: 570, superkingdom_taxid: 2)
    create(:taxon_lineage, tax_name: "Klebsiella", taxid: 570, genus_taxid: 570, superkingdom_taxid: 2)

    # Two pipeline runs so we exercise the PARTITION BY / per-run reset.
    @pr1 = create(:pipeline_run, sample: create(:sample, project: create(:project), initial_workflow: workflow),
                                 total_reads: 1122, adjusted_remaining_reads: 316, subsample: 1_000_000,
                                 taxon_counts_data: taxon_counts_data)
    @pr2 = create(:pipeline_run, sample: create(:sample, project: create(:project), initial_workflow: workflow),
                                 total_reads: 2244, adjusted_remaining_reads: 632, subsample: 1_000_000,
                                 taxon_counts_data: taxon_counts_data)
  end

  def ranks_by_run(taxa_per_sample: HeatmapHelper::CLIENT_FILTERING_TAXA_PER_SAMPLE)
    samples = Sample.where(id: [@pr1.sample_id, @pr2.sample_id])
    response = described_class.call(samples, mock_background_id, min_reads: 0, taxa_per_sample: taxa_per_sample)
    [@pr1.id, @pr2.id].index_with do |pr_id|
      (response[pr_id] && response[pr_id]["taxon_counts"] || []).map { |row| row["rank"] }
    end
  end

  it "resets ranks to 1 for every pipeline run (partition-by behavior)" do
    ranks_by_run.each_value do |ranks|
      expect(ranks).to include(1), "each pipeline run's ranking must start at 1"
    end
  end

  it "assigns unique, contiguous ranks starting at 1 within each run" do
    ranks_by_run.each_value do |ranks|
      next if ranks.empty?

      sorted = ranks.sort
      expect(sorted).to eq(sorted.uniq), "ranks within a run must be unique"
      expect(sorted).to eq((1..ranks.length).to_a), "ranks within a run must be contiguous from 1"
    end
  end

  it "never returns more rows per run than taxa_per_sample" do
    ranks_by_run(taxa_per_sample: 2).each_value do |ranks|
      expect(ranks.length).to be <= 2
      expect(ranks.max).to be <= 2 unless ranks.empty?
    end
  end

  it "no longer primes MySQL session variables" do
    # The rewrite removed the `connection.execute("SET @rank := 0, ...")` priming
    # statement. (Match the executable form, not explanatory comments that may
    # still mention the old SQL.)
    expect(File.read(Rails.root.join("app/services/top_taxons_sql_service.rb")))
      .not_to match(/execute\(["']\s*SET @rank/)
  end
end

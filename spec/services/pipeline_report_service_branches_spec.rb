require 'rails_helper'

# Branch sweep for PipelineReportService, companion to pipeline_report_service_spec.rb.
# The main spec drives the full Illumina report end-to-end; the arms below are the
# ones it never reaches. They are exercised directly on the private helpers (via
# #send) because most of them are only reachable from deep inside `generate` with
# fixture data that would take a full second pipeline run to stage.
#
# Arms covered:
#   * get_pipeline_status: the nil-run WAITING shell, the FAILED arm and the
#     SUCCEEDED (results_finalized) arm.
#   * get_taxon_count_fields_to_pluck / get_metadata_by_technology: the nanopore
#     arms (the main spec is Illumina-only).
#   * merge_taxon_count_structures: level present vs. absent, and the
#     "tax_id missing from the target level" guard.
#   * merge_contigs: the "contigs but no matching taxon counts" warn arm.
#   * compute_count_per_million: the nanopore base_count/bpm arms and the
#     "count type absent" skip.
#   * compute_z_score_mass_normalized: the absent-from-background guard (both
#     halves of its && ) and the nanopore vs. Illumina normalization arms.
#   * compute_aggregate_scores: the species-present/genus-missing warn arms.
#   * report_csv: the nil sorted_genus_tax_ids early return.
#
# Spec-only, no app changes.
RSpec.describe PipelineReportService, type: :service do
  let(:project) { create(:project) }
  let(:sample) { create(:sample, project: project) }

  def service_for(technology, background_id: nil)
    pr = create(:pipeline_run, sample: sample, technology: technology)
    svc = described_class.new(pr, background_id)
    svc.instance_variable_set(:@timer, Timer.new("spec"))
    [svc, pr]
  end

  let(:illumina) { PipelineRun::TECHNOLOGY_INPUT[:illumina] }
  let(:nanopore) { PipelineRun::TECHNOLOGY_INPUT[:nanopore] }

  describe "#get_pipeline_status" do
    it "returns the WAITING shell when there is no pipeline run at all" do
      svc, = service_for(illumina)

      status = svc.send(:get_pipeline_status, nil)

      expect(status[:pipelineRunStatus]).to eq("WAITING")
      expect(status[:reportReady]).to be(false)
      expect(status[:jobStatus]).to eq("Waiting to Start or Receive Files")
      # The nil-run shell carries no hasErrors key at all.
      expect(status).not_to have_key(:hasErrors)
    end

    it "reports FAILED for a run whose job status failed" do
      svc, = service_for(illumina)
      failed_run = create(:pipeline_run, sample: sample, job_status: "1.Host Filtering-FAILED", error_message: "boom")

      status = svc.send(:get_pipeline_status, failed_run)

      expect(status[:pipelineRunStatus]).to eq("FAILED")
      expect(status[:hasErrors]).to be_truthy
      expect(status[:errorMessage]).to eq("boom")
    end

    it "reports SUCCEEDED for a finalized run with no failure" do
      svc, = service_for(illumina)
      done_run = create(
        :pipeline_run,
        sample: sample,
        job_status: PipelineRun::STATUS_CHECKED,
        results_finalized: PipelineRun::FINALIZED_SUCCESS
      )

      status = svc.send(:get_pipeline_status, done_run)

      expect(status[:pipelineRunStatus]).to eq("SUCCEEDED")
      expect(status[:hasErrors]).to be_falsey
    end

    it "stays WAITING for a run that is neither failed nor finalized" do
      svc, = service_for(illumina)
      running = create(:pipeline_run, sample: sample, job_status: "1.Host Filtering-STARTED", results_finalized: PipelineRun::IN_PROGRESS)

      expect(svc.send(:get_pipeline_status, running)[:pipelineRunStatus]).to eq("WAITING")
    end
  end

  describe "#get_taxon_count_fields_to_pluck" do
    it "adds the short-read fields for Illumina and the long-read fields for nanopore" do
      svc, = service_for(illumina)

      short = svc.send(:get_taxon_count_fields_to_pluck, illumina)
      long = svc.send(:get_taxon_count_fields_to_pluck, nanopore)

      expect(short).to eq(
        PipelineReportService::TAXON_COUNT_FIELDS_TO_PLUCK + PipelineReportService::TAXON_COUNT_SHORT_READS_FIELDS_TO_PLUCK
      )
      expect(long).to eq(
        PipelineReportService::TAXON_COUNT_FIELDS_TO_PLUCK + PipelineReportService::TAXON_COUNT_LONG_READS_FIELDS_TO_PLUCK
      )
      expect(short).not_to eq(long)
    end

    it "returns nil for an unrecognized technology" do
      svc, = service_for(illumina)
      expect(svc.send(:get_taxon_count_fields_to_pluck, "PacBio")).to be_nil
    end
  end

  describe "#get_metadata_by_technology" do
    it "reports bases (not reads) and no background for a nanopore run" do
      svc, pr = service_for(nanopore)
      create(:job_stat, pipeline_run: pr, task: "human_filtered_bases", bases_after: 5000)
      create(:job_stat, pipeline_run: pr, task: "subsampled_bases", bases_after: 1200)

      metadata = svc.send(:get_metadata_by_technology, { existing: 1 })

      expect(metadata[:backgroundId]).to be_nil
      expect(metadata[:preSubsamplingCount]).to eq(5000)
      expect(metadata[:postSubsamplingCount]).to eq(1200)
      expect(metadata[:existing]).to eq(1)
      # The Illumina-only key must NOT be present on the nanopore arm.
      expect(metadata).not_to have_key(:truncatedReadsCount)
    end

    it "reports reads and the truncated count for an Illumina run" do
      svc, = service_for(illumina)

      metadata = svc.send(:get_metadata_by_technology, {})

      expect(metadata).to have_key(:truncatedReadsCount)
      expect(metadata).to have_key(:hasByteRanges)
    end
  end

  describe "#merge_taxon_count_structures" do
    it "merges merged_nt_nr into matching tax ids and skips levels and ids with no counterpart" do
      svc, = service_for(illumina)
      merged = {
        TaxonCount::TAX_LEVEL_SPECIES => {
          573 => { merged_nt_nr: { count: 10 } },
          999 => { merged_nt_nr: { count: 77 } }, # no counterpart -> skipped
        },
        # No genus/family entries at all -> the "level not present" arm.
      }
      counts = {
        TaxonCount::TAX_LEVEL_SPECIES => { 573 => { nt: { count: 3 } } },
        TaxonCount::TAX_LEVEL_GENUS => { 570 => { nt: { count: 4 } } },
        TaxonCount::TAX_LEVEL_FAMILY => {},
      }

      svc.send(:merge_taxon_count_structures, merged, counts)

      expect(counts[TaxonCount::TAX_LEVEL_SPECIES][573][:merged_nt_nr]).to eq(count: 10)
      expect(counts[TaxonCount::TAX_LEVEL_SPECIES]).not_to have_key(999)
      expect(counts[TaxonCount::TAX_LEVEL_GENUS][570]).not_to have_key(:merged_nt_nr)
    end
  end

  describe "#merge_contigs" do
    it "folds contig counts into the matching species counts" do
      svc, = service_for(illumina)
      counts = { TaxonCount::TAX_LEVEL_SPECIES => { 573 => { nt: {} } }, TaxonCount::TAX_LEVEL_GENUS => {} }

      svc.send(:merge_contigs, { 573 => { "NT" => { 10 => 2, 5 => 1 } } }, counts)

      expect(counts[TaxonCount::TAX_LEVEL_SPECIES][573][:nt][:contigs]).to eq(3)
      expect(counts[TaxonCount::TAX_LEVEL_SPECIES][573][:nt][:contig_r]).to eq(25)
    end

    it "warns instead of raising when there are contigs but no taxon counts for the taxon" do
      svc, pr = service_for(illumina)
      counts = { TaxonCount::TAX_LEVEL_SPECIES => {}, TaxonCount::TAX_LEVEL_GENUS => {} }

      expect(Rails.logger).to receive(:warn).with(/PR=#{pr.id}.*has contigs but not taxon counts for taxon 573/)

      expect { svc.send(:merge_contigs, { 573 => { "NT" => { 10 => 2 } } }, counts) }.not_to raise_error
      expect(counts[TaxonCount::TAX_LEVEL_SPECIES]).to eq({})
    end
  end

  describe "#compute_count_per_million" do
    it "writes bpm from base_count for a nanopore run" do
      svc, = service_for(nanopore)
      taxa = { 573 => { nt: { base_count: 250 }, nr: {} } }

      svc.send(:compute_count_per_million, count_types: [:nt, :nr], taxa_counts: taxa, total_count: 1_000_000)

      expect(taxa[573][:nt][:bpm]).to eq(250.0)
      expect(taxa[573][:nt]).not_to have_key(:rpm)
      # The blank nr hash is skipped entirely.
      expect(taxa[573][:nr]).to eq({})
    end

    it "writes rpm from count for an Illumina run" do
      svc, = service_for(illumina)
      taxa = { 573 => { nt: { count: 250 } } }

      svc.send(:compute_count_per_million, count_types: [:nt], taxa_counts: taxa, total_count: 1_000_000)

      expect(taxa[573][:nt][:rpm]).to eq(250.0)
      expect(taxa[573][:nt]).not_to have_key(:bpm)
    end
  end

  describe "#compute_z_score_mass_normalized" do
    it "returns the absent-from-background score when there is no mass-normalized stdev" do
      svc, = service_for(illumina)

      score = svc.send(:compute_z_score_mass_normalized, 100, 1.0, nil, 500)

      expect(score).to eq(PipelineReportService::Z_SCORE_WHEN_ABSENT_FROM_BACKGROUND)
    end

    it "returns the absent-from-background score when the sample has no ERCC reads" do
      svc, = service_for(illumina)

      score = svc.send(:compute_z_score_mass_normalized, 100, 1.0, 2.0, 0)

      expect(score).to eq(PipelineReportService::Z_SCORE_WHEN_ABSENT_FROM_BACKGROUND)
    end

    it "divides the count by the ERCC reads for an Illumina run" do
      svc, = service_for(illumina)

      # (100/500 - 0.1) / 0.05 == 2.0
      expect(svc.send(:compute_z_score_mass_normalized, 100, 0.1, 0.05, 500)).to be_within(1e-9).of(2.0)
    end

    it "uses the raw count for a nanopore run (no ERCC normalization)" do
      svc, = service_for(nanopore)

      # (100 - 90) / 5 == 2.0, independent of the ERCC value.
      expect(svc.send(:compute_z_score_mass_normalized, 100, 90, 5, 500)).to be_within(1e-9).of(2.0)
    end

    it "clamps an extreme z-score to the configured maximum" do
      svc, = service_for(nanopore)

      expect(svc.send(:compute_z_score_mass_normalized, 10_000, 0, 1, 500))
        .to eq(PipelineReportService::Z_SCORE_MAX)
    end
  end

  describe "#compute_aggregate_scores" do
    let(:genus_counts) { { 570 => { nt: { z_score: 2, rpm: 5 }, nr: { z_score: 2, rpm: 5 } } } }

    it "warns for a species with NT/NR data whose genus has none" do
      svc, = service_for(illumina)
      species_counts = {
        573 => { genus_tax_id: 570, nt: { z_score: 1, rpm: 10 }, nr: { z_score: 1, rpm: 10 } },
      }
      bare_genus = { 570 => {} }

      expect(Rails.logger).to receive(:warn).with(/NT data present for species 573 but missing for genus 570/)
      expect(Rails.logger).to receive(:warn).with(/NR data present for species 573 but missing for genus 570/)

      svc.send(:compute_aggregate_scores, species_counts, bare_genus)

      # No background -> scores are nil on both species and genus.
      expect(species_counts[573][:agg_score]).to be_nil
      expect(bare_genus[570][:agg_score]).to be_nil
    end

    it "does not warn when the genus carries the same count types as the species" do
      svc, = service_for(illumina)
      species_counts = { 573 => { genus_tax_id: 570, nt: { z_score: 1, rpm: 10 }, nr: { z_score: 1, rpm: 10 } } }

      expect(Rails.logger).not_to receive(:warn)

      svc.send(:compute_aggregate_scores, species_counts, genus_counts)
    end
  end

  describe "#report_csv" do
    it "returns an empty string when there are no genus tax ids to report" do
      svc, = service_for(illumina)

      expect(svc.send(:report_csv, {}, nil)).to eq("")
    end
  end
end

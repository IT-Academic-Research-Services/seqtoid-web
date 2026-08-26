require "rails_helper"

# Branch coverage for ReadsStatsService#get_job_stats. The existing
# reads_stats_service_spec runs a pipeline with no ERCC reads, so the ERCC-present
# arms under both the STAR (legacy) and FASTP host-filtering paths are undriven.
# These contexts set total_ercc_reads so those arms fire. The step-order path stays
# on the simple sort (no S3 step-status file in test), so no AWS is exercised.
RSpec.describe ReadsStatsService do
  let(:project) { create(:project) }
  let(:sample) { create(:sample, project_id: project.id) }

  def build_run(id, stats)
    create(:pipeline_run,
           id: id,
           sample_id: sample.id,
           pipeline_execution_strategy: "step_function",
           job_status: PipelineRun::STATUS_CHECKED,
           finalized: 1,
           s3_output_prefix: nil,
           total_reads: 1_000_000,
           total_ercc_reads: 5000)
    stats.each do |task, reads_after|
      create(:job_stat, task: task, reads_after: reads_after, pipeline_run_id: id)
    end
  end

  context "when a STAR host-filtering run has ERCC reads" do
    before do
      build_run(23_001, [
                  ["fastqs", 1_000_000],
                  ["star_out", 900_000],
                ])
    end

    it "separates ERCC reads from the STAR host-filtering step" do
      stats = ReadsStatsService.call(Sample.where(id: sample.id))
      step_names = stats[sample.id][:steps].pluck(:name)
      # ERCC reads_after = total_reads - total_ercc_reads = 995_000
      ercc_reads = stats[sample.id][:steps].find { |s| s[:readsAfter] == 995_000 }
      expect(ercc_reads).to be_present
      expect(step_names).to include(StringUtil.humanize_step_name("star_out"))
    end
  end

  context "when a FASTP host-filtering run has ERCC reads" do
    before do
      build_run(23_002, [
                  ["fastqs", 1_000_000],
                  ["fastp_out", 800_000],
                  ["fastp_low_complexity_reads", 950_000],
                ])
    end

    it "derives ERCC reads from the low-complexity step and keeps the FASTP step" do
      stats = ReadsStatsService.call(Sample.where(id: sample.id))
      step_names = stats[sample.id][:steps].pluck(:name)
      # ERCC reads_after = low_complexity_reads - total_ercc_reads = 945_000
      ercc_reads = stats[sample.id][:steps].find { |s| s[:readsAfter] == 945_000 }
      expect(ercc_reads).to be_present
      expect(step_names).to include(StringUtil.humanize_step_name("fastp_qc"))
    end
  end

  context "when a FASTP host-filtering run has no ERCC reads" do
    before do
      create(:pipeline_run,
             id: 23_003,
             sample_id: sample.id,
             pipeline_execution_strategy: "step_function",
             job_status: PipelineRun::STATUS_CHECKED,
             finalized: 1,
             s3_output_prefix: nil,
             total_reads: 1_000_000,
             total_ercc_reads: nil)
      [["fastqs", 1_000_000], ["fastp_out", 800_000]].each do |task, reads_after|
        create(:job_stat, task: task, reads_after: reads_after, pipeline_run_id: 23_003)
      end
    end

    it "keeps the FASTP step without inserting an ERCC step" do
      stats = ReadsStatsService.call(Sample.where(id: sample.id))
      step_names = stats[sample.id][:steps].pluck(:name)
      expect(step_names).to include(StringUtil.humanize_step_name("fastp_qc"))
      expect(step_names).not_to include("ERCC")
    end
  end

  context "when a v8.1 run exposes a modern host-filtering step order" do
    before do
      create(:pipeline_run,
             id: 23_004,
             sample_id: sample.id,
             pipeline_version: "8.1",
             wdl_version: "8.1.0",
             pipeline_execution_strategy: "step_function",
             job_status: PipelineRun::STATUS_CHECKED,
             finalized: 1,
             s3_output_prefix: nil,
             total_reads: 1_000_000,
             total_ercc_reads: 5000)
      [
        ["fastqs", 1_000_000],
        ["fastp_out", 800_000],
        ["fastp_low_complexity_reads", 950_000],
        ["bowtie2_host_filtered_out", 700_000],
      ].each do |task, reads_after|
        create(:job_stat, task: task, reads_after: reads_after, pipeline_run_id: 23_004)
      end
      # step_statuses reads a per-stage status JSON from S3; stub it so the modern
      # host-filtering step-order branch (star insert + fastp expansion) is driven
      # without any real S3 access.
      status_json = {
        "validate_input" => { "status" => "finished" },
        "star_out" => { "status" => "finished" },
        "fastp_qc" => { "status" => "finished" },
        "bowtie2_filter" => { "status" => "finished" },
      }.to_json
      allow(S3Util).to receive(:get_s3_file).and_return(status_json)
    end

    it "builds an ordered step list from the modern step statuses" do
      stats = ReadsStatsService.call(Sample.where(id: sample.id))
      steps = stats[sample.id][:steps]
      expect(steps).to be_an(Array)
      expect(steps).to be_present
      steps.each { |s| expect(s).to include(:name, :readsAfter) }
    end
  end
end

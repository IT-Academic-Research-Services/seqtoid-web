require "rails_helper"

# Branch coverage for ReadsStatsService's step-ordering paths. The sibling specs
# (reads_stats_service_spec / reads_stats_service_branches_spec) only ever pass a
# non-nil sample scope and, when they do stub a step-status file, use a single v8.1
# run -- so the nil-samples guard, the "second pipeline version under an already-seen
# wdl version" arm, the pre-8.2 ERCC-insert arm and the "ordered step has no job stat"
# arm are all undriven. Named _branch_paths to avoid colliding with the existing
# _branches companion.
RSpec.describe ReadsStatsService do
  let(:project) { create(:project) }

  def build_run(sample, id, stats, attrs = {})
    create(:pipeline_run, {
      id: id,
      sample_id: sample.id,
      pipeline_execution_strategy: "step_function",
      job_status: PipelineRun::STATUS_CHECKED,
      finalized: 1,
      s3_output_prefix: nil,
      total_reads: 1_000_000,
      total_ercc_reads: nil,
    }.merge(attrs))
    stats.each { |task, reads_after| create(:job_stat, task: task, reads_after: reads_after, pipeline_run_id: id) }
  end

  describe "the nil-samples guard" do
    it "warns and returns an empty result instead of blowing up" do
      allow(Rails.logger).to receive(:warn)

      expect(described_class.call(nil)).to eq({})
      expect(Rails.logger).to have_received(:warn).with("ReadsStatsService call with samples = nil")
    end
  end

  describe "two pipeline versions sharing one wdl version" do
    let(:sample_a) { create(:sample, project_id: project.id, name: "A") }
    let(:sample_b) { create(:sample, project_id: project.id, name: "B") }

    before do
      build_run(sample_a, 24_101, [["fastqs", 1_000_000], ["star_out", 900_000]],
                wdl_version: "5.0.0", pipeline_version: "5.0")
      build_run(sample_b, 24_102, [["fastqs", 1_000_000], ["star_out", 800_000]],
                wdl_version: "5.0.0", pipeline_version: "5.1")
    end

    it "nests both pipeline versions under the single shared wdl version" do
      stats = described_class.call(Sample.where(id: [sample_a.id, sample_b.id]))

      expect(stats.keys).to contain_exactly(sample_a.id, sample_b.id)
      expect(stats[sample_a.id][:wdlVersion]).to eq("5.0.0")
      expect(stats[sample_a.id][:pipelineVersion]).to eq("5.0")
      expect(stats[sample_b.id][:pipelineVersion]).to eq("5.1")
      expect(stats[sample_a.id][:name]).to eq("A")
      expect(stats[sample_b.id][:name]).to eq("B")
    end
  end

  describe "a legacy (pre-modern-host-filtering) run with a real step order" do
    let(:sample) { create(:sample, project_id: project.id) }

    before do
      build_run(sample, 24_103,
                [["fastqs", 1_000_000], ["star_out", 900_000], ["trimmomatic_out", 850_000]],
                wdl_version: "3.0.0", pipeline_version: "3.0", total_ercc_reads: 5000)
      status_json = {
        "star_out" => { "status" => "finished" },
        "trimmomatic_out" => { "status" => "finished" },
        "priceseq_out" => { "status" => "finished" },
      }.to_json
      allow(S3Util).to receive(:get_s3_file).and_return(status_json)
    end

    it "inserts ERCC before STAR and drops ordered steps that produced no job stat" do
      steps = described_class.call(Sample.where(id: sample.id))[sample.id][:steps]
      names = steps.pluck(:name)

      ercc_name = StringUtil.humanize_step_name(described_class::ERCC)
      expect(names).to include(ercc_name)
      expect(names.index(ercc_name)).to be < names.index(StringUtil.humanize_step_name("star_out"))
      # priceseq_out is in the step order but has no JobStat row, so it is dropped.
      expect(names).not_to include(StringUtil.humanize_step_name("priceseq_out"))
    end
  end

  describe "a v8.2 run, where ERCCs are already part of the step order" do
    let(:sample) { create(:sample, project_id: project.id) }

    before do
      build_run(sample, 24_104,
                [["fastqs", 1_000_000], ["fastp_out", 800_000], ["fastp_low_complexity_reads", 950_000]],
                wdl_version: "8.2.0", pipeline_version: "8.2", total_ercc_reads: 5000)
      status_json = {
        "fastp_qc" => { "status" => "finished" },
        "bowtie2_filter" => { "status" => "finished" },
      }.to_json
      allow(S3Util).to receive(:get_s3_file).and_return(status_json)
    end

    it "expands fastp into its sub-steps without manually re-inserting ERCC" do
      steps = described_class.call(Sample.where(id: sample.id))[sample.id][:steps]
      names = steps.pluck(:name)

      # fastp_qc is replaced by the quality/short/low-complexity breakdown; only the steps
      # that actually have job stats survive.
      expect(names).to include(StringUtil.humanize_step_name(described_class::FASTP_LOW_COMPLEXITY_READS))
      expect(names).not_to include(StringUtil.humanize_step_name("fastp_qc"))
    end
  end

  describe "a run with no step-status file at all" do
    let(:sample) { create(:sample, project_id: project.id) }

    before do
      build_run(sample, 24_105, [["fastqs", 1_000_000], ["star_out", 900_000], ["trimmomatic_out", 850_000]])
    end

    it "falls back to sorting the steps by descending reads" do
      steps = described_class.call(Sample.where(id: sample.id))[sample.id][:steps]

      expect(steps.pluck(:readsAfter)).to eq(steps.pluck(:readsAfter).sort.reverse)
      expect(steps.pluck(:name)).to include(StringUtil.humanize_step_name("star_out"))
    end
  end
end

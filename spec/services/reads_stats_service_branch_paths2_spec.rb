require "rails_helper"

# Third-wave branch coverage for ReadsStatsService#get_step_orders. The existing companions
# (_spec / _branches / _branch_paths) always give the step-order builder a status file that
# contains the step it is looking for: a legacy run whose order includes star_out, or a
# modern run whose order includes fastp_qc. The two "the step I want is not in this order"
# arms -- no STAR step to insert ERCC before, and a modern run whose order has no fastp_qc
# to expand -- have never been taken.
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

  describe "a legacy run whose step order contains no STAR step" do
    let(:sample) { create(:sample, project_id: project.id) }

    before do
      build_run(sample, 24_201,
                [["fastqs", 1_000_000], ["trimmomatic_out", 850_000], ["priceseq_out", 800_000]],
                wdl_version: "3.0.0", pipeline_version: "3.0")
      status_json = {
        "trimmomatic_out" => { "status" => "finished" },
        "priceseq_out" => { "status" => "finished" },
      }.to_json
      allow(S3Util).to receive(:get_s3_file).and_return(status_json)
    end

    it "keeps the declared order untouched, with no ERCC step inserted" do
      steps = described_class.call(Sample.where(id: sample.id))[sample.id][:steps]
      names = steps.pluck(:name)

      expect(names).not_to include("ERCC")
      expect(names).to eq([
                            StringUtil.humanize_step_name("trimmomatic_out"),
                            StringUtil.humanize_step_name("priceseq_out"),
                          ])
    end
  end

  describe "a modern-host-filtering run whose step order contains no fastp_qc step" do
    let(:sample) { create(:sample, project_id: project.id) }

    before do
      build_run(sample, 24_202,
                [["fastqs", 1_000_000], ["bowtie2_host_filtered_out", 700_000]],
                wdl_version: "8.1.0", pipeline_version: "8.1", total_ercc_reads: 5000)
      status_json = {
        "bowtie2_filter" => { "status" => "finished" },
        "hisat2_filter" => { "status" => "finished" },
      }.to_json
      allow(S3Util).to receive(:get_s3_file).and_return(status_json)
    end

    it "does not expand fastp into its sub-steps" do
      steps = described_class.call(Sample.where(id: sample.id))[sample.id][:steps]
      names = steps.pluck(:name)

      expect(names).not_to include(StringUtil.humanize_step_name(described_class::FASTP_LOW_COMPLEXITY_READS))
      expect(names).not_to include(StringUtil.humanize_step_name(described_class::FASTP_TOO_SHORT_READS))
      # bowtie2_filter is kept under its step-order name; hisat2_filter is dropped because
      # it produced no job stat.
      expect(names).to eq([StringUtil.humanize_step_name("bowtie2_filter")])
    end
  end
end

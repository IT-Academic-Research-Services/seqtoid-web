require 'rails_helper'

# Coverage Wave 2 (branch): pipeline_run_stage_spec.rb only covers update_job_status.
# This fills the many small predicate/dispatch branches: started?, succeeded?/failed?/
# completed?, dag_name, step_status_file_paths (sfn vs non-sfn, step_number<=2 split),
# step_statuses (found + JSON error branches, then empty), run_job (already-started
# early return, sfn vs no-arn), duration_hrs/run_time, batch_job_status_url, log_url.
RSpec.describe PipelineRunStage, type: :model do
  let(:user) { build_stubbed(:user) }
  let(:sample) { build_stubbed(:sample, user: user) }

  def stage(attrs = {}, pr_attrs = {})
    pr = FactoryBot.build_stubbed(:pipeline_run, sample: sample, pipeline_version: "3.7", **pr_attrs)
    FactoryBot.build_stubbed(:pipeline_run_stage, pipeline_run: pr, **attrs)
  end

  describe "#started?" do
    it "is true when job_command is present and false otherwise" do
      expect(stage(job_command: "arn:x").started?).to eq(true)
      expect(stage(job_command: nil).started?).to eq(false)
    end
  end

  describe "status predicates" do
    it "distinguishes succeeded / failed / completed" do
      succeeded = stage(job_status: PipelineRunStage::STATUS_SUCCEEDED)
      failed = stage(job_status: PipelineRunStage::STATUS_FAILED)
      running = stage(job_status: PipelineRunStage::STATUS_STARTED)

      expect(succeeded.succeeded?).to eq(true)
      expect(succeeded.completed?).to eq(true)
      expect(failed.failed?).to eq(true)
      expect(failed.completed?).to eq(true)
      expect(running.completed?).to eq(false)
    end
  end

  describe "#dag_name" do
    it "maps a known stage name and returns nil for an unknown one" do
      expect(stage(name: PipelineRunStage::HOST_FILTERING_STAGE_NAME).dag_name)
        .to eq(PipelineRunStage::DAG_NAME_HOST_FILTER)
      expect(stage(name: "Totally Unknown Stage").dag_name).to be_nil
    end
  end

  describe "#step_status_file_paths" do
    it "builds sfn_results_path-based paths when the run is a step function" do
      s = stage({ name: PipelineRunStage::HOST_FILTERING_STAGE_NAME, step_number: 1 })
      allow(s.pipeline_run).to receive(:step_function?).and_return(true)
      allow(s.pipeline_run).to receive(:sfn_results_path).and_return("s3://bucket/sfn")
      paths = s.step_status_file_paths
      expect(paths).to all(start_with("s3://bucket/sfn/"))
      expect(paths.first).to include("host_filter_status2.json")
    end

    it "uses sample_output path for early stages (step_number <= 2)" do
      s = stage({ name: PipelineRunStage::HOST_FILTERING_STAGE_NAME, step_number: 1 })
      allow(s.pipeline_run).to receive(:step_function?).and_return(false)
      allow(s.pipeline_run.sample).to receive(:sample_output_s3_path).and_return("s3://b/out")
      paths = s.step_status_file_paths
      expect(paths.first).to start_with("s3://b/out/3.7/")
    end

    it "uses sample_postprocess path for later stages (step_number > 2)" do
      s = stage({ name: PipelineRunStage::POSTPROCESS_STAGE_NAME, step_number: 3 })
      allow(s.pipeline_run).to receive(:step_function?).and_return(false)
      allow(s.pipeline_run.sample).to receive(:sample_postprocess_s3_path).and_return("s3://b/pp")
      paths = s.step_status_file_paths
      expect(paths.first).to start_with("s3://b/pp/3.7/")
    end
  end

  describe "#step_statuses" do
    let(:s) { stage(name: PipelineRunStage::HOST_FILTERING_STAGE_NAME, step_number: 1) }

    before do
      allow(s).to receive(:step_status_file_paths).and_return(["s3://b/a.json", "s3://b/b.json"])
    end

    it "returns the parsed JSON of the first readable status file" do
      allow(S3Util).to receive(:get_s3_file).with("s3://b/a.json", level: :warn).and_return('{"foo":"bar"}')
      expect(s.step_statuses).to eq("foo" => "bar")
    end

    it "returns {} when the readable status file is malformed JSON" do
      allow(S3Util).to receive(:get_s3_file).with("s3://b/a.json", level: :warn).and_return("not json")
      expect(s.step_statuses).to eq({})
    end

    it "returns {} when no status file is present" do
      allow(S3Util).to receive(:get_s3_file).and_return(nil)
      expect(s.step_statuses).to eq({})
    end
  end

  describe "#run_job" do
    it "returns early when already started and not failed" do
      s = stage(job_command: "arn:already", job_status: PipelineRunStage::STATUS_STARTED)
      expect(s).not_to receive(:save)
      s.run_job
    end

    it "marks STARTED with the sfn arn when an execution arn exists" do
      s = stage({ job_command: nil }, sfn_execution_arn: "arn:sfn")
      allow(s).to receive(:save).and_return(true)
      s.run_job
      expect(s.job_status).to eq(PipelineRunStage::STATUS_STARTED)
      expect(s.job_command).to eq("arn:sfn")
    end

    it "marks FAILED when there is no execution arn" do
      s = stage({ job_command: nil }, sfn_execution_arn: nil)
      allow(s).to receive(:save).and_return(true)
      s.run_job
      expect(s.job_status).to eq(PipelineRunStage::STATUS_FAILED)
    end
  end

  describe "#duration_hrs / #run_time" do
    it "returns nil duration when run_time is nil (not started, not completed)" do
      s = stage(job_status: PipelineRunStage::STATUS_STARTED, job_command: nil)
      expect(s.duration_hrs).to be_nil
    end

    it "computes elapsed time for a started-but-not-completed stage" do
      s = stage(job_status: PipelineRunStage::STATUS_STARTED, job_command: "arn:x",
                created_at: 2.hours.ago)
      expect(s.run_time).to be > 0
      expect(s.duration_hrs).to be_within(0.1).of(2.0)
    end
  end

  describe "#batch_job_status_url" do
    it "returns nil when job_description is blank" do
      expect(stage(job_description: nil).batch_job_status_url).to be_nil
    end

    it "returns the AWS Batch console URL for the jobId" do
      s = stage(job_description: { jobId: "j1", jobQueue: "q1" }.to_json)
      expect(s.batch_job_status_url).to eq(
        "https://#{AwsUtil::AWS_REGION}.console.aws.amazon.com/batch/home" \
        "?region=#{AwsUtil::AWS_REGION}#jobs/detail/j1"
      )
    end

    it "returns nil early when the parsed job hash has no jobId" do
      s = stage(job_description: { other: "x" }.to_json)
      expect(s.batch_job_status_url).to be_nil
    end
  end

  describe "#log_url" do
    it "returns nil without a job_log_id and a URL with one" do
      expect(stage(job_log_id: nil).log_url).to be_nil
      s = stage(job_log_id: "log-1")
      allow(AwsUtil).to receive(:get_cloudwatch_url).and_return("https://cw/x")
      expect(s.log_url).to eq("https://cw/x")
    end
  end
end

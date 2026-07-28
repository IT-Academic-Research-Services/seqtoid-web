require "rails_helper"

# Third branch sweep for PipelineRunsHelper. The existing companion specs
# (pipeline_runs_helper_branches_spec.rb / _versions_spec.rb) already cover
# file_generated_since_run, update_pipeline_version, pipeline_version_at_least
# and get_additional_outputs. What is still untaken here:
#   - fetch_pipeline_version: the regex-matching version, the non-matching
#     fallback (EXTERNALLY_MANAGED), and the Aws::S3 error rescue.
#   - get_key_from_s3_json: download succeeded vs failed.
#   - download_to_filename? / exists_in_s3?: both cli outcomes.
#   - get_pipeline_run_logs: each of the five early-return guards plus the
#     success path, and the non-step-function fall-through.
#   - check_for_user_error's step-function decision tree: blank stage,
#     never-started SFN, INPUT_ERRORS with and without a message, UncaughtError,
#     RunFailed (YAML parses / YAML raises), and an unrecognized error code.
RSpec.describe PipelineRunsHelper, type: :helper do
  describe "#fetch_pipeline_version" do
    def stub_s3_body(body)
      allow(S3_CLIENT).to receive(:get_object).and_return(double("resp", body: StringIO.new(body)))
    end

    it "extracts the major.minor prefix when the contents match the version pattern" do
      stub_s3_body("8.3.1-rc2\n")
      expect(helper.fetch_pipeline_version("s3://bucket/version.txt")).to eq("8.3")
    end

    it "falls back to the whole string when the contents do not match the pattern" do
      stub_s3_body("  EXTERNALLY_MANAGED \n")
      expect(helper.fetch_pipeline_version("s3://bucket/version.txt")).to eq("EXTERNALLY_MANAGED")
    end

    it "logs and returns nil on an S3 service error" do
      allow(S3_CLIENT).to receive(:get_object).and_raise(
        Aws::S3::Errors::NoSuchKey.new(Seahorse::Client::RequestContext.new, "missing")
      )
      expect(Rails.logger).to receive(:error).with(a_string_including("Failed to get pipeline version"))

      expect(helper.fetch_pipeline_version("s3://bucket/version.txt")).to be_nil
    end
  end

  describe "#get_key_from_s3_json" do
    it "reads the key out of the downloaded json" do
      allow(PipelineRun).to receive(:download_file_with_retries) do |_s3, path, _tries, _flag|
        File.write(path, { "error" => "InsufficientReadsError" }.to_json)
        true
      end

      expect(helper.get_key_from_s3_json("s3://bucket/x.json", "error")).to eq("InsufficientReadsError")
    end

    it "returns nil without parsing anything when the download fails" do
      allow(PipelineRun).to receive(:download_file_with_retries).and_return(false)
      expect(helper.get_key_from_s3_json("s3://bucket/x.json", "error")).to be_nil
    end
  end

  describe "#download_to_filename? and #exists_in_s3?" do
    it "reports the aws cli outcome for a successful copy and a missing key" do
      ok = instance_double(Process::Status, success?: true)
      bad = instance_double(Process::Status, success?: false)

      allow(Open3).to receive(:capture3).with("aws", "s3", "cp", "s3://b/k", "/tmp/x").and_return(["", "", ok])
      expect(helper.download_to_filename?("s3://b/k", "/tmp/x")).to be(true)

      allow(Open3).to receive(:capture3).with("aws", "s3", "ls", "s3://b/missing").and_return(["", "", bad])
      expect(helper.exists_in_s3?("s3://b/missing")).to be(false)

      allow(Open3).to receive(:capture3).with("aws", "s3", "ls", "s3://b/present").and_return(["stuff", "", ok])
      expect(helper.exists_in_s3?("s3://b/present")).to be(true)
    end
  end

  describe "#get_pipeline_run_logs" do
    let(:project) { create(:project) }
    let(:sample) { create(:sample, project: project) }

    it "returns [] for a step-function run with no execution arn" do
      pr = create(:pipeline_run, sample: sample, sfn_execution_arn: nil)
      expect(pr.get_pipeline_run_logs).to eq([])
    end

    it "returns nil for a legacy dag run (the whole body is step-function gated)" do
      pr = create(:pipeline_run,
                  sample: sample,
                  sfn_execution_arn: nil,
                  pipeline_execution_strategy: PipelineRun.pipeline_execution_strategies[:directed_acyclic_graph])
      expect(pr.get_pipeline_run_logs).to be_nil
    end

    context "for a step-function run with an arn" do
      let(:pr) { create(:pipeline_run, sample: sample, sfn_execution_arn: "arn:aws:states:::execution:x:y") }

      def stub_history(events)
        allow_any_instance_of(SfnExecution).to receive(:history)
          .and_return(double("history", to_h: { events: events }))
      end

      def stub_batch_jobs(jobs)
        batch = double("batch")
        allow(batch).to receive(:describe_jobs).and_return(double("resp", to_h: { jobs: jobs }))
        allow(AwsClient).to receive(:[]).with(:batch).and_return(batch)
        batch
      end

      it "reports an expired step function when there are no events" do
        stub_history(nil)
        expect(pr.get_pipeline_run_logs).to eq(["No step function events, step function may have expired"])
      end

      it "reports no submitted batch jobs when no event carries batch details" do
        stub_history([{ task_submitted_event_details: nil }])
        expect(pr.get_pipeline_run_logs).to eq(["No submitted batch jobs"])
      end

      it "reports expired batch information when describe_jobs comes back empty" do
        stub_history([{ task_submitted_event_details: { output: { "JobArn" => "job-arn" }.to_json } }])
        stub_batch_jobs([])

        expect(pr.get_pipeline_run_logs).to eq(["No result from batch job, the batch information may have expired"])
      end

      it "reports a just-started job when the log stream name is blank" do
        stub_history([{ task_submitted_event_details: { output: { "JobArn" => "job-arn" }.to_json } }])
        stub_batch_jobs([{ container: { log_stream_name: "" } }])

        expect(pr.get_pipeline_run_logs).to eq(["No log stream name, batch job may have just started"])
      end

      it "returns the cloudwatch messages for the last submitted job once a stream exists" do
        stub_history(
          [
            { task_submitted_event_details: nil },
            { task_submitted_event_details: { output: { "JobArn" => "first-arn" }.to_json } },
            { task_submitted_event_details: { output: { "JobArn" => "last-arn" }.to_json } },
          ]
        )
        batch = stub_batch_jobs([{ container: { log_stream_name: "stream/1" } }])
        logs = double("logs")
        allow(logs).to receive(:get_log_events).and_return(
          double("resp", to_h: { events: [{ message: "line one" }, { message: "line two" }] })
        )
        allow(AwsClient).to receive(:[]).with(:cloudwatchlogs).and_return(logs)

        expect(pr.get_pipeline_run_logs(5)).to eq(["line one", "line two"])
        expect(batch).to have_received(:describe_jobs).with({ "jobs": ["last-arn"] })
        expect(logs).to have_received(:get_log_events).with(hash_including("log_stream_name": "stream/1", "limit": 5))
      end
    end
  end

  describe "#check_for_user_error on the step-function path" do
    let(:project) { create(:project) }
    let(:sample) { create(:sample, project: project) }
    let(:pipeline_run) { create(:pipeline_run, sample: sample, sfn_execution_arn: "arn:sfn:x") }
    let(:failed_stage) do
      create(:pipeline_run_stage,
             pipeline_run: pipeline_run,
             name: "stage 1",
             job_status: PipelineRunStage::STATUS_FAILED)
    end

    it "returns a nil pair when there is no failed stage at all" do
      expect(helper.check_for_user_error(nil)).to eq([nil, nil])
    end

    it "returns a nil pair when the SFN never started (blank execution arn)" do
      pr = create(:pipeline_run, sample: sample, sfn_execution_arn: nil)
      stage = create(:pipeline_run_stage, pipeline_run: pr, name: "stage 1", job_status: PipelineRunStage::STATUS_FAILED)

      expect(helper.check_for_user_error(stage)).to eq([nil, nil])
    end

    it "uses the canned INPUT_ERRORS copy when the SFN supplies no message of its own" do
      allow(failed_stage.pipeline_run).to receive(:sfn_pipeline_error).and_return(["InsufficientReadsError", nil])

      expect(helper.check_for_user_error(failed_stage)).to eq(
        ["InsufficientReadsError", WorkflowRun::INPUT_ERRORS["InsufficientReadsError"]]
      )
    end

    it "prefers the SFN-supplied message over the canned copy" do
      allow(failed_stage.pipeline_run).to receive(:sfn_pipeline_error)
        .and_return(["InvalidFileFormatError", "line 12 is malformed"])

      expect(helper.check_for_user_error(failed_stage)).to eq(["InvalidFileFormatError", "line 12 is malformed"])
    end

    it "drops the error code but keeps the message for an UncaughtError" do
      allow(failed_stage.pipeline_run).to receive(:sfn_pipeline_error).and_return(["UncaughtError", "raw traceback"])

      expect(helper.check_for_user_error(failed_stage)).to eq([nil, "raw traceback"])
    end

    # NOTE: the RunFailed arm calls YAML.safe_load(error_message, { symbolize_names: true }).
    # Under Psych 4/5 the options must be keyword arguments, so passing the hash
    # positionally always raises ArgumentError and the rescue swallows it. The
    # `return [nil, message]` line after it is therefore unreachable on this
    # Ruby/Psych combination -- both examples below assert the observable result.
    it "returns a nil pair for a RunFailed error even when the payload is well-formed YAML" do
      allow(failed_stage.pipeline_run).to receive(:sfn_pipeline_error)
        .and_return(["RunFailed", { "message" => "the step blew up" }.to_yaml])

      expect(helper.check_for_user_error(failed_stage)).to eq([nil, nil])
    end

    it "returns a nil pair when the RunFailed payload is not parseable YAML" do
      allow(failed_stage.pipeline_run).to receive(:sfn_pipeline_error).and_return(["RunFailed", "\tnot: [valid"])

      expect(helper.check_for_user_error(failed_stage)).to eq([nil, nil])
    end

    it "returns a nil pair for an SFN error code it does not recognize" do
      allow(failed_stage.pipeline_run).to receive(:sfn_pipeline_error).and_return(["SomethingElse", "msg"])

      expect(helper.check_for_user_error(failed_stage)).to eq([nil, nil])
    end
  end
end

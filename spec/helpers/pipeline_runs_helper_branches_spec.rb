require "rails_helper"

# Branch coverage for PipelineRunsHelper. Targets conditional arms the existing
# pipeline_runs_helper specs leave undriven:
#   - parse_sfn_execution_history_hash: the per-stage status resolution (SUCCEEDED /
#     RUNNING / FAILED / PENDING) and the "aborted before stage 1" special case.
#   - file_generated_since_run: the non-zero-exit early return, the timestamp compare,
#     and the parse-failure rescue.
#   - update_pipeline_version: the blank-and-newer THEN vs the already-set ELSE.
# Pure/in-memory except stubbed Open3/helper calls; no real AWS.
RSpec.describe PipelineRunsHelper, type: :helper do
  describe "#parse_sfn_execution_history_hash" do
    # Build one SFN event: `type` drives the TaskState/PassState select and the
    # Entered/Exited marker; `name` maps to a "<stage><task>" the regexp matches.
    def event(type, name)
      { "type" => type, "stateEnteredEventDetails" => { "name" => name } }
    end

    it "resolves per-stage status to SUCCEEDED, RUNNING, and PENDING" do
      history = {
        "events" => [
          # HostFilter (stage 1): entered AND exited on the Succeeded task -> SUCCEEDED
          event("TaskStateEntered", "HostFilterSucceeded"),
          event("TaskStateExited", "HostFilterSucceeded"),
          # NonHostAlignment (stage 2): started (SPOT entered) but not completed -> RUNNING
          event("TaskStateEntered", "NonHostAlignmentSPOT"),
          # Postprocess (stage 3): only a Failed-task exit, never started -> PENDING
          event("TaskStateExited", "PostprocessFailed"),
        ],
      }

      result = helper.parse_sfn_execution_history_hash(history)

      expect(result["1"]["status"]).to eq("SUCCEEDED")
      expect(result["2"]["status"]).to eq("RUNNING")
      expect(result["3"]["status"]).to eq("PENDING")
    end

    it "marks a started-but-unfinished stage FAILED and synthesizes stage 1 when aborted early" do
      # An ExecutionFailed event sets failed_state; the only stage present is stage 2,
      # so the started-but-unfinished stage resolves to FAILED, and because result has
      # no "1" the aborted-before-stage-1 special case synthesizes a failed HostFilter.
      history = {
        "events" => [
          event("TaskStateEntered", "NonHostAlignmentSPOT"),
          { "type" => "ExecutionFailed" },
        ],
      }

      result = helper.parse_sfn_execution_history_hash(history)

      expect(result).to eq("1" => { "stage" => "HostFilter", "status" => "FAILED" })
    end
  end

  describe "#file_generated_since_run" do
    let(:record) { instance_double(PipelineRun, created_at: Time.utc(2020, 1, 1)) }

    it "returns false when the s3 ls exits non-zero" do
      allow(Open3).to receive(:capture3).and_return(["", "err", instance_double(Process::Status, exitstatus: 1)])
      expect(helper.file_generated_since_run(record, "s3://bucket/key")).to be(false)
    end

    it "returns true when the listed file is newer than the record" do
      allow(Open3).to receive(:capture3)
        .and_return(["2024-01-01 12:00:00  42 key", "", instance_double(Process::Status, exitstatus: 0)])
      expect(helper.file_generated_since_run(record, "s3://bucket/key")).to be(true)
    end

    it "returns nil when the listing timestamp cannot be parsed" do
      allow(Open3).to receive(:capture3)
        .and_return(["not-a-timestamp-at-all", "", instance_double(Process::Status, exitstatus: 0)])
      expect(helper.file_generated_since_run(record, "s3://bucket/key")).to be_nil
    end
  end

  describe "#check_for_user_error (non-step-function path)" do
    let(:project) { create(:project) }
    let(:sample) { create(:sample, project: project) }
    let(:pipeline_run) do
      create(:pipeline_run, sample: sample, pipeline_execution_strategy: "directed_acyclic_graph")
    end

    it "returns no error for a stage number outside the host-filter/alignment stages" do
      stage = create(:pipeline_run_stage, pipeline_run: pipeline_run, step_number: 3)
      expect(helper.check_for_user_error(stage)).to eq([nil, nil])
    end

    it "reports a faulty-input error, backfilling a blank pipeline version" do
      pipeline_run.update_column(:pipeline_version, nil)
      stage = create(:pipeline_run_stage, pipeline_run: pipeline_run, step_number: 1)
      expect(helper).to receive(:update_pipeline_version)
      allow(helper).to receive(:file_generated_since_run).and_return(true)
      allow(helper).to receive(:get_key_from_s3_json).and_return("bad file format")

      expect(helper.check_for_user_error(stage)).to eq(["FAULTY_INPUT", "bad file format"])
    end

    it "reports an invalid intermediate-step error when only that file is present" do
      pipeline_run.update_column(:pipeline_version, "8.0")
      stage = create(:pipeline_run_stage, pipeline_run: pipeline_run, step_number: 2)
      expect(helper).not_to receive(:update_pipeline_version)
      # First lookup (user-input validation) absent, second (invalid step input) present.
      allow(helper).to receive(:file_generated_since_run).and_return(false, true)
      allow(helper).to receive(:get_key_from_s3_json).and_return("INVALID_STEP_CODE")

      expect(helper.check_for_user_error(stage)).to eq(["INVALID_STEP_CODE", nil])
    end
  end

  describe "#update_pipeline_version" do
    let(:pipeline_run) { create(:pipeline_run, sample: create(:sample, project: create(:project))) }

    it "fetches and saves the version when the column is blank and the file is newer" do
      pipeline_run.update_column(:pipeline_version, nil)
      allow(helper).to receive(:file_generated_since_run).and_return(true)
      allow(helper).to receive(:fetch_pipeline_version).and_return("8.1")

      helper.update_pipeline_version(pipeline_run, :pipeline_version, "s3://bucket/version.txt")

      expect(pipeline_run.reload.pipeline_version).to eq("8.1")
    end

    it "leaves an already-set version untouched" do
      pipeline_run.update_column(:pipeline_version, "7.0")
      expect(helper).not_to receive(:fetch_pipeline_version)

      helper.update_pipeline_version(pipeline_run, :pipeline_version, "s3://bucket/version.txt")

      expect(pipeline_run.reload.pipeline_version).to eq("7.0")
    end
  end
end

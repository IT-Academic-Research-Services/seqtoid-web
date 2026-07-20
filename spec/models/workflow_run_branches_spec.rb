require 'rails_helper'

# Coverage Wave (branch): workflow_run_spec.rb covers status/monitor/inputs but
# leaves a few small branches undriven. This spec drives ONLY those branches
# (no DB writes, no AWS) so each arm is hit and each test fails if its branch is
# inverted or removed:
#   - #dispatch: the workflow if/elsif/elsif selection (consensus/amr/benchmark)
#     plus the implicit else (an unsupported workflow dispatches nothing)
#   - #get_input: the `inputs&.[]` safe-navigation, present vs nil receiver
#   - #sfn_output_path: the `s3_output_prefix || sample...` present-vs-nil operand
#   - #remote_status_failed?: FAILED_REMOTE_STATUSES.include? true vs false
RSpec.describe WorkflowRun, type: :model do
  describe "#dispatch" do
    it "dispatches consensus-genome runs to the CG service (first if arm)" do
      wr = WorkflowRun.new(workflow: WorkflowRun::WORKFLOW[:consensus_genome])
      expect(SfnCgPipelineDispatchService).to receive(:call).with(wr)
      expect(SfnAmrPipelineDispatchService).not_to receive(:call)
      expect(SfnBenchmarkPipelineDispatchService).not_to receive(:call)
      wr.dispatch
    end

    it "dispatches amr runs to the AMR service (elsif arm)" do
      wr = WorkflowRun.new(workflow: WorkflowRun::WORKFLOW[:amr])
      expect(SfnAmrPipelineDispatchService).to receive(:call).with(wr)
      expect(SfnCgPipelineDispatchService).not_to receive(:call)
      wr.dispatch
    end

    it "dispatches benchmark runs to the benchmark service (elsif arm)" do
      wr = WorkflowRun.new(workflow: WorkflowRun::WORKFLOW[:benchmark])
      expect(SfnBenchmarkPipelineDispatchService).to receive(:call).with(wr)
      expect(SfnCgPipelineDispatchService).not_to receive(:call)
      wr.dispatch
    end

    it "dispatches nothing for an unsupported workflow (implicit else arm)" do
      wr = WorkflowRun.new(workflow: WorkflowRun::WORKFLOW[:short_read_mngs])
      expect(SfnCgPipelineDispatchService).not_to receive(:call)
      expect(SfnAmrPipelineDispatchService).not_to receive(:call)
      expect(SfnBenchmarkPipelineDispatchService).not_to receive(:call)
      wr.dispatch
    end
  end

  describe "#get_input" do
    it "returns the value when inputs are present (safe-nav non-nil receiver)" do
      wr = WorkflowRun.new(inputs_json: '{"foo":"bar"}')
      expect(wr.get_input("foo")).to eq("bar")
    end

    it "returns nil when there are no inputs (safe-nav nil receiver)" do
      wr = WorkflowRun.new(inputs_json: nil)
      expect(wr.get_input("foo")).to be_nil
    end
  end

  describe "#sfn_output_path" do
    it "uses s3_output_prefix when present (first || operand)" do
      wr = WorkflowRun.new(s3_output_prefix: "s3://bucket/explicit/prefix")
      expect(wr.sfn_output_path).to eq("s3://bucket/explicit/prefix")
    end

    it "falls back to the sample output path when the prefix is nil (|| operand)" do
      wr = WorkflowRun.new(s3_output_prefix: nil)
      allow(wr).to receive(:sample).and_return(double("sample", sample_output_s3_path: "s3://bucket/sample/results"))
      expect(wr.sfn_output_path).to eq("s3://bucket/sample/results")
    end
  end

  describe "#remote_status_failed?" do
    it "is true for a failed remote status (include? true)" do
      wr = WorkflowRun.new
      expect(wr.send(:remote_status_failed?, WorkflowRun::FAILED_REMOTE_STATUSES.first)).to eq(true)
    end

    it "is false for a non-failed remote status (include? false)" do
      wr = WorkflowRun.new
      expect(wr.send(:remote_status_failed?, WorkflowRun::STATUS[:succeeded])).to eq(false)
    end
  end
end

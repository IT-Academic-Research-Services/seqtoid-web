require "rails_helper"

# Per-user concurrent-run cap for consensus-genome / AMR workflow runs, and the "Queued" display.
RSpec.describe WorkflowRun, type: :model do
  create_users

  let(:project) { create(:project, users: [@joe]) }
  let(:sample) { create(:sample, project: project, user: @joe) }

  def wr(workflow = WorkflowRun::WORKFLOW[:consensus_genome])
    create(:workflow_run, sample: sample, user: @joe, workflow: workflow, status: WorkflowRun::STATUS[:created])
  end

  describe "#dispatch" do
    it "dispatches as before when the user is under the cap" do
      allow(PipelineDispatchThrottle).to receive(:defer?).and_return(false)
      run = wr
      expect(SfnCgPipelineDispatchService).to receive(:call).with(run)
      run.dispatch
      expect(run.reload.dispatch_deferred_at).to be_nil
    end

    it "holds a CG run (no SFN dispatch) when the user is at the cap" do
      allow(PipelineDispatchThrottle).to receive(:defer?).and_return(true)
      run = wr
      expect(SfnCgPipelineDispatchService).not_to receive(:call)
      run.dispatch
      expect(run.reload).to be_dispatch_deferred
    end

    it "holds an AMR run the same way" do
      allow(PipelineDispatchThrottle).to receive(:defer?).and_return(true)
      run = wr(WorkflowRun::WORKFLOW[:amr])
      expect(SfnAmrPipelineDispatchService).not_to receive(:call)
      run.dispatch
      expect(run.reload).to be_dispatch_deferred
    end

    it "never caps benchmark runs" do
      expect(PipelineDispatchThrottle).not_to receive(:defer?)
      run = wr(WorkflowRun::WORKFLOW[:benchmark])
      expect(SfnBenchmarkPipelineDispatchService).to receive(:call).with(run)
      run.dispatch
    end
  end

  describe "#release_deferred_dispatch!" do
    it "clears the hold and dispatches without re-checking the cap" do
      run = wr
      run.update!(dispatch_deferred_at: 1.hour.ago)
      expect(PipelineDispatchThrottle).not_to receive(:defer?)
      expect(SfnCgPipelineDispatchService).to receive(:call).with(run)
      expect(run.release_deferred_dispatch!).to be(true)
      expect(run.reload.dispatch_deferred_at).to be_nil
    end

    it "is a no-op for a run that is no longer held" do
      run = wr
      expect(SfnCgPipelineDispatchService).not_to receive(:call)
      expect(run.release_deferred_dispatch!).to be(false)
    end
  end

  describe "#display_status" do
    it "is QUEUED while held, otherwise the mapped status" do
      run = wr
      expect(run.display_status).to eq("CREATED")
      run.update!(dispatch_deferred_at: Time.current)
      expect(run.display_status).to eq("QUEUED")
      run.update!(status: WorkflowRun::STATUS[:running], sfn_execution_arn: "arn:x")
      expect(run.display_status).to eq("RUNNING")
    end
  end
end

require "rails_helper"

RSpec.describe ReleaseDeferredPipelineRuns, type: :job do
  create_users

  let(:project) { create(:project, users: [@joe]) }

  before { allow_any_instance_of(PipelineRun).to receive(:release_deferred_dispatch!).and_call_original }

  def running_run(user)
    create(:pipeline_run, sample: create(:sample, project: project, user: user), finalized: 0,
                          sfn_execution_arn: "arn:sfn:#{SecureRandom.hex(4)}")
  end

  def deferred_run(user, deferred_at)
    create(:pipeline_run, sample: create(:sample, project: project, user: user), finalized: 0,
                          sfn_execution_arn: nil, dispatch_deferred_at: deferred_at)
  end

  def configure_cap(value)
    AppConfigHelper.set_app_config(AppConfig::MAX_ACTIVE_PIPELINE_RUNS_PER_USER, value)
  end

  it "does nothing when nothing is deferred" do
    expect(described_class.new.run).to eq(0)
  end

  it "releases up to the user's headroom, oldest first" do
    configure_cap("3")
    running_run(@joe)
    oldest = deferred_run(@joe, 3.hours.ago)
    middle = deferred_run(@joe, 2.hours.ago)
    newest = deferred_run(@joe, 1.hour.ago)
    released = []
    allow_any_instance_of(PipelineRun).to receive(:release_deferred_dispatch!) { |pr| released << pr.id }

    described_class.new.run
    expect(released).to eq([oldest.id, middle.id])
    expect(released).not_to include(newest.id)
  end

  it "releases nothing for a user still at the cap" do
    configure_cap("1")
    running_run(@joe)
    deferred_run(@joe, 1.hour.ago)
    expect_any_instance_of(PipelineRun).not_to receive(:release_deferred_dispatch!)
    described_class.new.run
  end

  it "releases every deferred run once the cap is removed" do
    3.times { |i| deferred_run(@joe, (i + 1).hours.ago) }
    allow_any_instance_of(PipelineRun).to receive(:release_deferred_dispatch!).and_return(true)
    expect(described_class.new.run).to eq(3)
  end

  it "keeps going (and alerts) when one release fails" do
    configure_cap("5")
    deferred_run(@joe, 2.hours.ago)
    deferred_run(@joe, 1.hour.ago)
    calls = 0
    allow_any_instance_of(PipelineRun).to receive(:release_deferred_dispatch!) do
      calls += 1
      raise StandardError, "sfn down" if calls == 1

      true
    end
    expect(LogUtil).to receive(:log_error).once
    expect(described_class.new.run).to eq(1)
  end

  it "releases deferred CG/AMR workflow runs too, oldest first across both run types" do
    configure_cap("2")
    wr = create(:workflow_run, sample: create(:sample, project: project, user: @joe), user: @joe,
                               status: WorkflowRun::STATUS[:created], dispatch_deferred_at: 3.hours.ago)
    pr = deferred_run(@joe, 2.hours.ago)
    deferred_run(@joe, 1.hour.ago)
    released = []
    allow_any_instance_of(PipelineRun).to receive(:release_deferred_dispatch!) { |r| released << [:pr, r.id] }
    allow_any_instance_of(WorkflowRun).to receive(:release_deferred_dispatch!) { |r| released << [:wr, r.id] }

    described_class.new.run
    expect(released).to eq([[:wr, wr.id], [:pr, pr.id]])
  end

  describe "PipelineRun#release_deferred_dispatch!" do
    it "clears the deferral and dispatches a long-read run" do
      pr = deferred_run(@joe, 1.hour.ago)
      pr.update!(technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      expect(pr).to receive(:dispatch)
      expect(pr.release_deferred_dispatch!).to be(true)
      expect(pr.reload.dispatch_deferred_at).to be_nil
    end

    it "is a no-op for a run that is no longer deferred" do
      pr = running_run(@joe)
      expect(pr).not_to receive(:dispatch)
      expect(pr.release_deferred_dispatch!).to be(false)
    end
  end
end

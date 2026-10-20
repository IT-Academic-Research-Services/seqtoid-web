require "rails_helper"

# The per-user concurrent-run cap at the mNGS upload kickoff (ENABLE_SFN_NOTIFICATIONS on, as in dev/staging/
# prod): a user at the cap gets a deferred run instead of a dispatched one.
RSpec.describe Sample, type: :model do
  create_users

  let(:project) { create(:project, users: [@joe]) }

  before do
    create(:alignment_config, name: AlignmentConfig.default_name)
    allow(Sample).to receive(:pipeline_commit).and_return("abc123")
    allow(VersionRetrievalService).to receive(:call).and_return(AlignmentConfig.default_name)
    allow(AppConfigHelper).to receive(:get_app_config).and_call_original
    allow(AppConfigHelper).to receive(:get_app_config).with(AppConfig::ENABLE_SFN_NOTIFICATIONS).and_return("1")
  end

  it "dispatches as before when the user is under the cap" do
    allow(PipelineDispatchThrottle).to receive(:defer?).and_return(false)
    expect_any_instance_of(PipelineRun).to receive(:dispatch)
    sample = create(:sample, project: project, user: @joe)

    sample.kickoff_pipeline
    expect(sample.pipeline_runs.reload.first.dispatch_deferred_at).to be_nil
  end

  it "defers (does not dispatch) when the user is at the cap" do
    allow(PipelineDispatchThrottle).to receive(:defer?).and_return(true)
    expect_any_instance_of(PipelineRun).not_to receive(:dispatch)
    sample = create(:sample, project: project, user: @joe)

    sample.kickoff_pipeline
    pr = sample.pipeline_runs.reload.first
    expect(pr.dispatch_deferred_at).to be_present
    expect(pr).to be_dispatch_deferred
  end

  it "a deferred run still counts as in progress, so a second kickoff does not create another run" do
    allow(PipelineDispatchThrottle).to receive(:defer?).and_return(true)
    sample = create(:sample, project: project, user: @joe)
    sample.kickoff_pipeline
    expect { sample.kickoff_pipeline }.not_to(change { sample.pipeline_runs.reload.count })
  end

  describe "PipelineRun queued display" do
    it "shows a held mNGS run as QUEUED in the table and explains it on the sample page" do
      pr = create(:pipeline_run, sample: create(:sample, project: project, user: @joe), finalized: 0,
                                 sfn_execution_arn: nil, dispatch_deferred_at: Time.current)
      expect(pr.status_display({})).to eq("QUEUED")
      expect(pr.job_status_display).to eq(PipelineRun::QUEUED_JOB_STATUS_DISPLAY)
    end
  end
end

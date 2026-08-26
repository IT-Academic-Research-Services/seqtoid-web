require "rails_helper"

# CZID-520 -- application-side data retention enforcement job.
RSpec.describe EnforceDataRetention, type: :job do
  create_users

  let(:window) { EnforceDataRetention::DEFAULT_RETENTION_DAYS }
  let(:old_age) { (window + 5).days.ago }
  let(:recent_age) { (window - 5).days.ago }

  before do
    # The job sleeps between deletion batches; skip the waits.
    allow(EnforceDataRetention).to receive(:sleep)
    # BulkDeletionService is exercised by its own specs; stub it so this job stays
    # offline and we can assert on how it is invoked.
    allow(BulkDeletionService).to receive(:call).and_return({ deleted_run_ids: [], deleted_sample_ids: [], error: nil })
  end

  def enable_enforcement
    AppConfigHelper.set_app_config(AppConfig::ENABLE_DATA_RETENTION_ENFORCEMENT, "1")
  end

  describe ".retention_days" do
    it "defaults when unset" do
      expect(EnforceDataRetention.retention_days).to eq(EnforceDataRetention::DEFAULT_RETENTION_DAYS)
    end

    it "reads the configured value" do
      AppConfigHelper.set_app_config(AppConfig::DATA_RETENTION_DAYS, "120")
      expect(EnforceDataRetention.retention_days).to eq(120)
    end
  end

  describe ".valid_window?" do
    it "accepts a window at or above the floor" do
      expect(EnforceDataRetention.valid_window?(EnforceDataRetention::MIN_RETENTION_DAYS)).to be(true)
    end

    it "rejects a window below the floor (fail-safe)" do
      expect(EnforceDataRetention.valid_window?(EnforceDataRetention::MIN_RETENTION_DAYS - 1)).to be(false)
    end
  end

  describe ".dry_run?" do
    it "is dry-run by default (flag unset)" do
      expect(EnforceDataRetention.dry_run?).to be(true)
    end

    it "is not dry-run once the flag is enabled" do
      enable_enforcement
      expect(EnforceDataRetention.dry_run?).to be(false)
    end

    it "stays dry-run when the ENV kill-switch is set even if the flag is on" do
      enable_enforcement
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("DATA_RETENTION_DRY_RUN").and_return("1")
      expect(EnforceDataRetention.dry_run?).to be(true)
    end
  end

  describe ".expired_candidates" do
    it "groups expired mNGS pipeline runs by [user_id, workflow] as sample ids" do
      sample = create(:sample, project: create(:project, users: [@joe]), user: @joe)
      create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina], created_at: old_age)

      groups = EnforceDataRetention.expired_candidates(Time.now.utc - window.days)
      expect(groups[[@joe.id, WorkflowRun::WORKFLOW[:short_read_mngs]]]).to contain_exactly(sample.id)
    end

    it "groups expired workflow runs by [user_id, workflow] as run ids" do
      sample = create(:sample, project: create(:project, users: [@joe]), user: @joe)
      wr = create(:workflow_run, sample: sample, workflow: WorkflowRun::WORKFLOW[:consensus_genome], created_at: old_age)

      groups = EnforceDataRetention.expired_candidates(Time.now.utc - window.days)
      expect(groups[[@joe.id, WorkflowRun::WORKFLOW[:consensus_genome]]]).to contain_exactly(wr.id)
    end

    it "excludes records within the retention window" do
      sample = create(:sample, project: create(:project, users: [@joe]), user: @joe)
      create(:workflow_run, sample: sample, workflow: WorkflowRun::WORKFLOW[:consensus_genome], created_at: recent_age)

      groups = EnforceDataRetention.expired_candidates(Time.now.utc - window.days)
      expect(groups).to be_empty
    end
  end

  describe "#perform" do
    it "aborts without deleting when the window is below the floor" do
      AppConfigHelper.set_app_config(AppConfig::DATA_RETENTION_DAYS, (EnforceDataRetention::MIN_RETENTION_DAYS - 1).to_s)
      enable_enforcement
      expect(BulkDeletionService).not_to receive(:call)
      EnforceDataRetention.perform
    end

    it "does NOT delete in dry-run mode (default), even with expired data" do
      sample = create(:sample, project: create(:project, users: [@joe]), user: @joe)
      create(:workflow_run, sample: sample, workflow: WorkflowRun::WORKFLOW[:consensus_genome], created_at: old_age)

      expect(BulkDeletionService).not_to receive(:call)
      EnforceDataRetention.perform
    end

    it "routes expired data through BulkDeletionService when enforcement is enabled" do
      enable_enforcement
      sample = create(:sample, project: create(:project, users: [@joe]), user: @joe)
      wr = create(:workflow_run, sample: sample, workflow: WorkflowRun::WORKFLOW[:consensus_genome], created_at: old_age)

      expect(BulkDeletionService).to receive(:call).with(
        object_ids: [wr.id],
        user: @joe,
        workflow: WorkflowRun::WORKFLOW[:consensus_genome]
      ).and_return({ deleted_run_ids: [wr.id], deleted_sample_ids: [], error: nil })

      EnforceDataRetention.perform
    end

    it "does nothing when there is no expired data" do
      enable_enforcement
      expect(BulkDeletionService).not_to receive(:call)
      EnforceDataRetention.perform
    end
  end
end

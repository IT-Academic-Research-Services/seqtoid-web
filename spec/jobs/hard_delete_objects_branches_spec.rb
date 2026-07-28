require "rails_helper"

# Companion branch sweep for HardDeleteObjects. The main spec
# (spec/jobs/hard_delete_objects_spec.rb) covers the happy paths and the
# generic "retry twice then log" arm of delete_object_with_retries. What is
# left untaken are:
#   - the give_up_callback: the is_a?(Aws::S3::Errors::ServiceError) THEN arm
#     (log a "further action is required" error) and its ELSE arm (stay silent
#     for a non-S3 exception).
#   - delete_object_with_retries: the Aws::S3::Errors::SlowDown THEN arm, which
#     bails out of the local retry loop immediately and re-raises so the
#     resque-retry exponential backoff takes over instead of retrying inline.
RSpec.describe HardDeleteObjects, type: :job do
  create_users

  let(:short_read_mngs) { WorkflowRun::WORKFLOW[:short_read_mngs] }
  let(:consensus_genome) { WorkflowRun::WORKFLOW[:consensus_genome] }

  # Aws error classes need a request context + message to construct.
  def slow_down_error
    Aws::S3::Errors::SlowDown.new(Seahorse::Client::RequestContext.new, "Please reduce your request rate.")
  end

  describe ".give_up_callback" do
    it "logs a 'further action is required' error when the final exception is an S3 service error" do
      exception = slow_down_error

      expect(LogUtil).to receive(:log_error).with(
        a_string_including("Bulk Deletion Error: All retries failed to destroy with args"),
        exception: exception
      )

      described_class.run_give_up_callbacks(exception, [1, 2], [3], short_read_mngs, 42)
    end

    it "stays silent when the final exception is not an S3 service error" do
      expect(LogUtil).not_to receive(:log_error)

      described_class.run_give_up_callbacks(ActiveRecord::RecordNotDestroyed.new("nope"), [1], [2], short_read_mngs, 42)
    end
  end

  describe ".delete_object_with_retries with an S3 SlowDown error" do
    before do
      @project = create(:project, users: [@joe])
      @sample = create(:sample, project: @project, user: @joe, name: "slow down sample", deleted_at: 5.minutes.ago)
      create(:deletion_log,
             object_id: @sample.id,
             user_id: @joe.id,
             user_email: @joe.email,
             object_type: Sample.name,
             soft_deleted_at: 5.minutes.ago)
      @pipeline_run = create(:pipeline_run,
                             sample: @sample,
                             technology: PipelineRun::TECHNOLOGY_INPUT[:illumina],
                             finalized: 1,
                             deleted_at: 5.minutes.ago)
      create(:deletion_log,
             object_id: @pipeline_run.id,
             user_id: @joe.id,
             user_email: @joe.email,
             object_type: PipelineRun.name,
             soft_deleted_at: 5.minutes.ago)
    end

    it "logs the backoff message and re-raises instead of retrying inline" do
      error = slow_down_error
      allow_any_instance_of(PipelineRun).to receive(:destroy!).and_raise(error)

      # The SlowDown arm must NOT fall through to the generic retry logging.
      expect(LogUtil).not_to receive(:log_message)
      expect(LogUtil).to receive(:log_error).with(
        a_string_including("Enter retry strategy with exponential backoff"),
        exception: error,
        object_id: @pipeline_run.id,
        workflow: short_read_mngs
      )
      # perform's own rescue logs the failure a second time before re-raising.
      expect(LogUtil).to receive(:log_error).with(
        a_string_including("Bulk Deletion Failed"),
        hash_including(exception: error)
      )

      expect do
        described_class.perform([@pipeline_run.id], [@sample.id], short_read_mngs, @joe.id)
      end.to raise_error(Aws::S3::Errors::SlowDown)

      # Nothing was hard-deleted, and the deletion log was not stamped.
      expect { @pipeline_run.reload }.not_to raise_error
      log = DeletionLog.find_by(object_id: @pipeline_run.id, object_type: PipelineRun.name, user_id: @joe.id)
      expect(log.hard_deleted_at).to be_nil
    end
  end

  describe ".hard_delete with the long_read_mngs workflow" do
    before do
      @project = create(:project, users: [@joe])
      @sample = create(:sample, project: @project, user: @joe, name: "ont sample", deleted_at: 5.minutes.ago)
      create(:deletion_log,
             object_id: @sample.id,
             user_id: @joe.id,
             user_email: @joe.email,
             object_type: Sample.name,
             soft_deleted_at: 5.minutes.ago)
      @pipeline_run = create(:pipeline_run,
                             sample: @sample,
                             technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore],
                             finalized: 1,
                             deleted_at: 5.minutes.ago)
      create(:deletion_log,
             object_id: @pipeline_run.id,
             user_id: @joe.id,
             user_email: @joe.email,
             object_type: PipelineRun.name,
             soft_deleted_at: 5.minutes.ago)
    end

    it "resolves ids against deletable_pipeline_runs (not workflow runs)" do
      allow(described_class).to receive(:sleep)
      # SAMPLES_BUCKET_NAME is not set standalone, so the real S3 sweep on
      # Sample#destroy would blow up; the S3 side is asserted in the main spec.
      allow(S3Util).to receive(:delete_s3_prefix)
      allow(S3Util).to receive(:abort_multipart_uploads)

      described_class.perform([@pipeline_run.id], [@sample.id], WorkflowRun::WORKFLOW[:long_read_mngs], @joe.id)

      expect { @pipeline_run.reload }.to raise_error(ActiveRecord::RecordNotFound)
      expect { @sample.reload }.to raise_error(ActiveRecord::RecordNotFound)
    end
  end

  describe ".hard_delete when nothing matches" do
    it "skips both the runs and the samples branches when the scoped relations are empty" do
      expect(described_class).not_to receive(:hard_delete_runs)
      expect(described_class).not_to receive(:hard_delete_samples)

      described_class.perform([], [], consensus_genome, @joe.id)
    end
  end
end

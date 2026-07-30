# Split out of hard_delete_objects_spec.rb (see also *_pipeline_runs_spec.rb and *_workflow_runs_spec.rb).
# The lighter cases: sample-only deletion, plus the top-level error-handling example.
require "rails_helper"

RSpec.describe HardDeleteObjects, type: :job do
  create_users

  let(:illumina) { PipelineRun::TECHNOLOGY_INPUT[:illumina] }
  let(:consensus_genome) { WorkflowRun::WORKFLOW[:consensus_genome] }
  let(:amr) { WorkflowRun::WORKFLOW[:amr] }
  let(:short_read_mngs) { WorkflowRun::WORKFLOW[:short_read_mngs] }
  let(:fake_sfn_execution_arn) { "fake:sfn:execution:arn".freeze }

  describe "#perform" do
    context "when sample ids are passed in but no run ids are passed in" do
      before do
        @project = create(:project, users: [@joe])
        @sample1 = create(:sample, project: @project,
                                   user: @joe,
                                   name: "Illumina sample with no pipeline runs",
                                   deleted_at: 5.minutes.ago)
        create(:deletion_log,
               object_id: @sample1.id,
               user_id: @joe.id,
               user_email: @joe.email,
               object_type: Sample.name,
               soft_deleted_at: 5.minutes.ago)
        object_ids = []
        sample_ids = [@sample1.id]
        HardDeleteObjects.perform(object_ids, sample_ids, short_read_mngs, @joe.id)
      end

      it "successfully destroys the samples" do
        expect { @sample1.reload }.to raise_error(ActiveRecord::RecordNotFound)
      end

      it "updates the hard_deleted_at field on the DeletionLog for the sample" do
        log = DeletionLog.find_by(object_id: @sample1.id, object_type: Sample.name, user_id: @joe.id)
        expect(log.hard_deleted_at).to be_within(1.minute).of(Time.now.utc)
      end
    end

    it "raises error and logs it if error occurs while performing deletions" do
      allow(HardDeleteObjects).to receive(:hard_delete).and_raise("Error")
      expect(LogUtil).to receive(:log_error)
      expect do
        HardDeleteObjects.perform([], [], consensus_genome, @joe.id)
      end.to raise_error("Error")
    end
  end
end

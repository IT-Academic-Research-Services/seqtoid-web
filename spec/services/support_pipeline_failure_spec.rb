# frozen_string_literal: true

require "rails_helper"

RSpec.describe SupportPipelineFailure do
  # Membership makes the project (and its samples) viewable by the user; Sample.viewable
  # keys off Project.editable, which is the projects_users join.
  let(:user) { create(:user) }
  let(:project) { create(:project, users: [user]) }
  let(:power) { Power.new(user) }

  context "an accessible failed mNGS (pipeline_run) sample" do
    let(:sample) do
      create(:sample, project: project, user: user, initial_workflow: "short-read-mngs")
    end
    let!(:run) do
      create(:pipeline_run,
             sample: sample,
             job_status: "1.Host Filtering-FAILED|READY",
             finalized: 1,
             error_message: "boom in host filtering",
             known_user_error: "InsufficientReadsError",
             pipeline_version: "8.3",
             wdl_version: "8.3.15",
             technology: "Illumina",
             sfn_execution_arn: "arn:aws:states:us-west-2:1:execution:x",
             s3_output_prefix: "s3://bucket/samples/1/1")
    end

    it "returns L1 detail with the parsed failed stage and raw error, support-side" do
      result = described_class.call(
        user_power: power, sample_id: sample.id, run_id: run.id, workflow: "short-read-mngs"
      )

      expect(result).to include(
        run_type: "pipeline_run",
        run_id: run.id,
        failed_stage: "Host Filtering",
        error_message: "boom in host filtering",
        known_user_error: "InsufficientReadsError",
        wdl_version: "8.3.15",
        sfn_execution_arn: "arn:aws:states:us-west-2:1:execution:x",
        s3_output_prefix: "s3://bucket/samples/1/1"
      )
    end

    it "gives the end user a friendly, non-technical one-liner (no raw error)" do
      result = described_class.call(user_power: power, sample_id: sample.id, run_id: run.id)
      expect(result[:user_facing]).to eq(
        "Your metagenomics run stopped during the Host Filtering step and did not finish."
      )
      expect(result[:user_facing]).not_to include("boom")
    end
  end

  it "returns nil for a sample the user cannot access (enforced via Power)" do
    other = create(:user)
    other_project = create(:project, users: [other])
    other_sample = create(:sample, project: other_project, user: other, initial_workflow: "short-read-mngs")
    create(:pipeline_run, sample: other_sample, job_status: "FAILED", finalized: 1)

    result = described_class.call(user_power: power, sample_id: other_sample.id, workflow: "short-read-mngs")
    expect(result).to be_nil
  end

  it "returns nil when the run has not failed" do
    sample = create(:sample, project: project, user: user, initial_workflow: "short-read-mngs")
    create(:pipeline_run, sample: sample, job_status: PipelineRun::STATUS_CHECKED, finalized: 1)

    expect(described_class.call(user_power: power, sample_id: sample.id)).to be_nil
  end

  it "handles workflow_run (CG/AMR) failures WITHOUT any AWS/SFN call (L1 = DB only)" do
    cg_sample = create(:sample, project: project, user: user, initial_workflow: "consensus-genome")
    wr = create(:workflow_run,
                sample: cg_sample,
                workflow: "consensus-genome",
                status: WorkflowRun::STATUS[:failed],
                error_message: "consensus genome failed")

    # The L1 path must NOT reach into Step Functions (that is L2, the enrichment lambda).
    expect_any_instance_of(WorkflowRun).not_to receive(:sfn_execution)
    expect_any_instance_of(WorkflowRun).not_to receive(:error_message_display)

    result = described_class.call(
      user_power: power, sample_id: cg_sample.id, run_id: wr.id, workflow: "consensus-genome"
    )

    expect(result).to include(
      run_type: "workflow_run",
      run_id: wr.id,
      status: "FAILED",
      error_message: "consensus genome failed"
    )
    expect(result[:user_facing]).to eq("Your consensus genome run did not finish successfully.")
  end

  it "returns nil when there is no run context" do
    expect(described_class.call(user_power: power, sample_id: nil)).to be_nil
  end
end

require "rails_helper"

RSpec.describe BenchmarkCreationService, type: :service do
  let(:user) { create(:admin) }
  let(:project) { create(:project, users: [user]) }
  let(:source_sample) { create(:sample, project: project, user: user) }
  let(:pipeline_run) { create(:pipeline_run, sample: source_sample) }

  before do
    allow(SfnBenchmarkPipelineDispatchService).to receive(:call).and_return(true)
    allow(AppConfigHelper).to receive(:get_workflow_version).and_call_original
    allow(AppConfigHelper).to receive(:get_workflow_version)
      .with(WorkflowRun::WORKFLOW[:benchmark]).and_return("0.0.3")
  end

  it "creates a checked benchmark sample + workflow run with the given inputs and dispatches it" do
    wr = described_class.call(
      run_ids: [pipeline_run.id],
      workflow_benchmarked: WorkflowRun::WORKFLOW[:short_read_mngs],
      project_id: project.id,
      user_id: user.id,
      sample_name: "rc-gate bench sample",
      ground_truth_file: "s3://bucket/truth.txt"
    )

    sample = Sample.find_by(name: "rc-gate bench sample", project_id: project.id)
    expect(sample.status).to eq(Sample::STATUS_CHECKED)
    expect(sample.initial_workflow).to eq(WorkflowRun::WORKFLOW[:benchmark])
    expect(wr.sample_id).to eq(sample.id)
    expect(wr.workflow).to eq(WorkflowRun::WORKFLOW[:benchmark])
    expect(wr.wdl_version).to eq("0.0.3")
    expect(wr.inputs).to eq(
      "run_ids" => [pipeline_run.id],
      "workflow_benchmarked" => WorkflowRun::WORKFLOW[:short_read_mngs],
      "ground_truth_file" => "s3://bucket/truth.txt"
    )
    expect(wr.workflow_by_class).to be_a(BenchmarkWorkflowRun)
    expect(SfnBenchmarkPipelineDispatchService).to have_received(:call).once
  end
end

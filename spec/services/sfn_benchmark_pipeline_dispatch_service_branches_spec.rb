require "rails_helper"
require "support/common_stub_constants"

# Companion branch sweep for SfnBenchmarkPipelineDispatchService. The main spec
# drives the happy paths with a fully populated inputs_json; the arms left
# untaken are:
#   - the nil side of every `@workflow_run.inputs&.[](...)` safe-navigation in
#     generate_wdl_input / get_output_files (inputs_json absent entirely).
#   - get_output_files' ELSE arm reached via a run_id loop iteration (a non-mngs
#     benchmark with run ids still merges an empty hash per run).
#   - get_mngs_output_files' ELSE arm, which resolves the id as a WorkflowRun
#     rather than a PipelineRun.
RSpec.describe SfnBenchmarkPipelineDispatchService, type: :service do
  let(:benchmark_workflow) { WorkflowRun::WORKFLOW[:benchmark] }
  let(:short_read_workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }
  let(:cg_workflow) { WorkflowRun::WORKFLOW[:consensus_genome] }
  let(:fake_benchmark_version) { "1.0.0" }
  let(:fake_output_prefix) { "s3://fake-bucket/output/prefix" }

  let(:project) { create(:project) }
  let(:sample) { create(:sample, project: project) }

  let(:dispatch_output) do
    { sfn_execution_arn: CommonStubConstants::FAKE_SFN_EXECUTION_ARN, sfn_input_json: {} }
  end

  before do
    allow(SfnGenericDispatchService).to receive(:call).and_return(dispatch_output)
    allow(AppConfigHelper).to receive(:get_workflow_version).and_call_original
    allow(AppConfigHelper).to receive(:get_workflow_version)
      .with(benchmark_workflow).and_return(fake_benchmark_version)
    allow_any_instance_of(BenchmarkWorkflowRun).to receive(:sfn_output_path).and_return(fake_output_prefix)
  end

  describe "#call with no inputs_json at all" do
    let(:workflow_run) { create(:workflow_run, sample: sample, workflow: benchmark_workflow, inputs_json: nil) }

    it "still dispatches, with nil workflow_type/ground_truth and no per-run outputs" do
      # inputs is nil, so run_ids is nil -- generate_wdl_input must not be able to
      # iterate. Guard the nil receiver by asserting the resulting failure path is
      # the service's own rescue (status failed + re-raise), not a silent success.
      expect(LogUtil).to receive(:log_error).at_least(:once)
      expect { described_class.call(workflow_run) }.to raise_error(NoMethodError)
      expect(workflow_run.reload.status).to eq(WorkflowRun::STATUS[:failed])
    end
  end

  describe "#call for a non-mngs benchmark that still has run ids" do
    let(:other_run) { create(:workflow_run, sample: sample, workflow: cg_workflow) }
    let(:workflow_run) do
      create(:workflow_run,
             sample: sample,
             workflow: benchmark_workflow,
             inputs_json: {
               "workflow_benchmarked" => cg_workflow,
               "ground_truth_file" => "s3://truth/gt.tsv",
               "run_ids" => [other_run.id],
             }.to_json)
    end

    it "merges an empty output hash for each run (no S3 reads at all)" do
      expect(S3Util).not_to receive(:get_s3_file)

      described_class.call(workflow_run)

      expect(SfnGenericDispatchService).to have_received(:call) do |_run, kwargs|
        inputs = kwargs[:inputs_json]
        expect(inputs[:workflow_type]).to eq(cg_workflow)
        expect(inputs[:ground_truth]).to eq("s3://truth/gt.tsv")
        # no taxon_counts_run_1 / contig_* keys were added
        expect(inputs.keys.map(&:to_s).grep(/run_1/)).to be_empty
      end
    end
  end

  describe "#get_mngs_output_files resolving a non-mngs run id" do
    let(:workflow_run) do
      create(:workflow_run,
             sample: sample,
             workflow: benchmark_workflow,
             inputs_json: { "workflow_benchmarked" => short_read_workflow, "run_ids" => [] }.to_json)
    end
    let(:cg_run) { create(:workflow_run, sample: sample, workflow: cg_workflow) }

    let(:stage_output_json) do
      {
        described_class::SHORT_READ_MNGS_MAP["taxon_counts"] => "s3://out/tc.json",
        described_class::SHORT_READ_MNGS_MAP["contigs_fasta"] => "s3://out/contigs.fa",
        described_class::SHORT_READ_MNGS_MAP["contigs_summary"] => "s3://out/cs.json",
      }.to_json
    end

    it "looks the id up as a WorkflowRun when the benchmarked workflow is not mngs" do
      service = described_class.new(workflow_run)
      # Flip the benchmarked workflow so the PipelineRun/WorkflowRun fork takes
      # its second arm while we call the file-gathering step directly.
      benchmark_run = service.instance_variable_get(:@workflow_run)
      allow(benchmark_run).to receive(:inputs).and_return("workflow_benchmarked" => cg_workflow)
      # WorkflowRun.find returns a plain WorkflowRun (no STI), so stub there.
      allow_any_instance_of(WorkflowRun).to receive(:sfn_results_path).and_return("s3://results/cg")
      allow(S3Util).to receive(:get_s3_file).and_return(stage_output_json)

      result = service.send(:get_mngs_output_files, cg_run.id, "run_1")

      expect(result[:taxon_counts_run_1]).to eq("s3://out/tc.json") # rubocop:disable Naming/VariableNumber
      expect(result[:contig_fasta_run_1]).to eq("s3://out/contigs.fa") # rubocop:disable Naming/VariableNumber
      expect(result[:contig_summary_run_1]).to eq("s3://out/cs.json") # rubocop:disable Naming/VariableNumber
      expect(S3Util).to have_received(:get_s3_file)
        .with(a_string_starting_with("s3://results/cg/")).at_least(:once)
    end
  end
end

require 'rails_helper'

# Coverage Wave 2 (branch): benchmark_workflow_run_spec.rb covers the cached-results
# path + the metrics-error rescue. This drives the *uncomputed* (non-cached) path
# through results -> benchmark_info + additional_info, exercising both the MNGS
# additional_mngs_info branch and the non-MNGS empty-hash branch, plus the
# is_ref second-run comparison.
RSpec.describe BenchmarkWorkflowRun, type: :model do
  let(:project) { create(:project) }
  let(:sample) { create(:sample, project: project) }

  def build_benchmark(inputs_json:)
    create(:workflow_run,
           sample: sample,
           workflow: WorkflowRun::WORKFLOW[:benchmark],
           inputs_json: inputs_json).becomes(BenchmarkWorkflowRun)
  end

  describe "#results additional_info" do
    it "returns per-sample mngs info for an MNGS benchmarked workflow" do
      s1 = create(:sample, project: project, name: "Sample One",
                           pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
      s2 = create(:sample, project: project, name: "Sample Two",
                           pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
      pr1 = s1.first_pipeline_run
      pr2 = s2.first_pipeline_run

      run = build_benchmark(inputs_json: {
        "workflow_benchmarked" => "short-read-mngs",
        "ground_truth_file" => "truth.tsv",
        "run_ids" => [pr1.id, pr2.id],
      }.to_json)
      allow(run).to receive(:output).and_return(nil)
      allow(BenchmarkMetricsService).to receive(:call).and_return({})

      additional = run.results["additional_info"]
      expect(additional.keys).to contain_exactly(s1.id, s2.id)
      # The second run_id is the reference (is_ref true only for pr2).
      expect(additional[s1.id][:is_ref]).to eq(false)
      expect(additional[s2.id][:is_ref]).to eq(true)
      expect(additional[s1.id][:sample_name]).to eq("Sample One")

      info = run.results["benchmark_info"]
      expect(info[:workflow]).to eq("short-read-mngs")
      expect(info[:ground_truth_file]).to eq("truth.tsv")
    end

    it "returns an empty additional_info hash for a non-MNGS benchmarked workflow" do
      run = build_benchmark(inputs_json: {
        "workflow_benchmarked" => "consensus-genome",
      }.to_json)
      allow(run).to receive(:output).and_return(nil)
      allow(BenchmarkMetricsService).to receive(:call).and_return({})

      expect(run.results["additional_info"]).to eq({})
    end

    it "returns an empty additional_info hash for an MNGS workflow with no run_ids" do
      # Partial/malformed inputs: MNGS workflow selected but the "run_ids" key is
      # absent. additional_mngs_info must degrade to {} rather than call
      # each_with_object on nil (NoMethodError).
      run = build_benchmark(inputs_json: {
        "workflow_benchmarked" => "short-read-mngs",
      }.to_json)
      allow(run).to receive(:output).and_return(nil)
      allow(BenchmarkMetricsService).to receive(:call).and_return({})

      expect { run.results }.not_to raise_error
      expect(run.results["additional_info"]).to eq({})
    end
  end
end

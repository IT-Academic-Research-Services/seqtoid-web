require 'rails_helper'

# Branch coverage wave 3 for BenchmarkWorkflowRun. The existing
# benchmark_workflow_run_spec / _branches_spec always build a run with well-formed
# inputs_json and fully-populated pipeline runs, so every `&.` safe-navigation in the
# model only ever takes its "receiver present" arm. This file drives the nil arms:
#   * inputs_json absent entirely -> `inputs&.[](...)` in get_output_name,
#     benchmark_info and additional_info degrade to nil / {}.
#   * a run_id whose PipelineRun lookup yields nothing -> every `pr&....` degrades.
#   * a PipelineRun with no sample and no alignment_config -> the second hop of
#     `pr&.sample&.name` / `pr&.alignment_config&.name` degrades.
RSpec.describe BenchmarkWorkflowRun, type: :model do
  let(:project) { create(:project) }
  let(:sample) { create(:sample, project: project) }

  def build_benchmark(inputs_json:)
    create(:workflow_run,
           sample: sample,
           workflow: WorkflowRun::WORKFLOW[:benchmark],
           inputs_json: inputs_json).becomes(BenchmarkWorkflowRun)
  end

  describe "with no inputs at all" do
    subject(:run) { build_benchmark(inputs_json: nil) }

    before do
      allow(run).to receive(:output).and_return(nil)
      allow(BenchmarkMetricsService).to receive(:call).and_return({})
    end

    it "formats the output name with a nil workflow name" do
      expect(run.inputs).to be_nil
      expect(run.get_output_name(BenchmarkWorkflowRun::OUTPUT_BENCHMARK_HTML_TEMPLATE))
        .to eq("benchmark._benchmark.benchmark_html")
    end

    it "returns a benchmark_info hash of nils rather than raising" do
      info = run.results["benchmark_info"]
      expect(info).to eq(workflow: nil, ground_truth_file: nil)
    end

    it "returns an empty additional_info because no workflow was benchmarked" do
      expect(run.results["additional_info"]).to eq({})
    end
  end

  describe "with run_ids that do not resolve to pipeline runs" do
    subject(:run) do
      build_benchmark(inputs_json: {
        "workflow_benchmarked" => "short-read-mngs",
        "run_ids" => [111, 222],
      }.to_json)
    end

    before do
      allow(run).to receive(:output).and_return(nil)
      allow(BenchmarkMetricsService).to receive(:call).and_return({})
    end

    it "degrades every per-run field to nil instead of raising NoMethodError" do
      # PipelineRun.find is the only source of `pr`; force the defensive nil the
      # model's `pr&.` guards exist for.
      allow(PipelineRun).to receive(:find).and_return(nil)

      additional = run.results["additional_info"]
      # Both run_ids collapse onto the nil sample_id key; the last one wins.
      expect(additional.keys).to eq([nil])
      expect(additional[nil]).to eq(
        sample_name: nil,
        run_id: 222,
        is_ref: true,
        pipeline_version: nil,
        ncbi_index_version: nil
      )
    end

    it "degrades the sample and alignment_config hops when the run has neither" do
      other_sample = create(:sample, project: project)
      pr = create(:pipeline_run, sample: other_sample, pipeline_version: "8.1")
      allow(pr).to receive(:sample).and_return(nil)
      allow(pr).to receive(:alignment_config).and_return(nil)
      allow(PipelineRun).to receive(:find).and_return(pr)

      additional = run.results["additional_info"]
      expect(additional.keys).to eq([nil])
      expect(additional[nil][:sample_name]).to be_nil
      expect(additional[nil][:ncbi_index_version]).to be_nil
      # The run object itself is present, so non-`sample` hops still resolve.
      expect(additional[nil][:pipeline_version]).to eq("8.1")
    end
  end
end

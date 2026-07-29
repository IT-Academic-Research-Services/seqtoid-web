require "rails_helper"

# Branch sweep for RetrievePipelineVizGraphDataService's status/edge helpers.
# The main spec drives the whole service end-to-end against one fixture graph,
# which only ever exercises a couple of arms of the status mapping. These
# examples poke the (private) pure helpers directly so every case/when arm and
# every ternary side is taken.
#
# The service is instantiated with `allocate` + explicit ivars: the constructor
# does a PipelineRun.find and walks pipeline_run_stages, none of which the
# helpers under test read.
RSpec.describe RetrievePipelineVizGraphDataService, type: :service do
  def build_service(all_dag_jsons: [], see_experimental: false, pipeline_run: nil)
    service = described_class.allocate
    service.instance_variable_set(:@all_dag_jsons, all_dag_jsons)
    service.instance_variable_set(:@see_experimental, see_experimental)
    service.instance_variable_set(:@pipeline_run, pipeline_run)
    service
  end

  let(:service) { build_service }

  describe "#redefine_job_status" do
    it "maps 'instantiated' and nil to notStarted" do
      expect(service.send(:redefine_job_status, "instantiated", nil)).to eq("notStarted")
      expect(service.send(:redefine_job_status, nil, nil)).to eq("notStarted")
    end

    it "maps 'uploaded' to finished" do
      expect(service.send(:redefine_job_status, "uploaded", nil)).to eq("finished")
    end

    it "maps 'pipeline_errored' to pipelineErrored" do
      expect(service.send(:redefine_job_status, "pipeline_errored", nil)).to eq("pipelineErrored")
    end

    it "maps both 'errored' and 'user_errored' to userErrored" do
      expect(service.send(:redefine_job_status, "errored", nil)).to eq("userErrored")
      expect(service.send(:redefine_job_status, "user_errored", nil)).to eq("userErrored")
    end

    it "maps running/finished_running to inProgress while the stage is healthy" do
      expect(service.send(:redefine_job_status, "running", PipelineRunStage::STATUS_STARTED)).to eq("inProgress")
      expect(service.send(:redefine_job_status, "finished_running", PipelineRunStage::STATUS_STARTED)).to eq("inProgress")
    end

    it "maps running to pipelineErrored when the enclosing stage failed" do
      expect(service.send(:redefine_job_status, "running", PipelineRunStage::STATUS_FAILED)).to eq("pipelineErrored")
    end

    it "returns nil for a status it does not recognize (no when matches)" do
      expect(service.send(:redefine_job_status, "some_new_status", nil)).to be_nil
    end
  end

  describe "#stage_job_status" do
    it "prefers userErrored over everything else" do
      expect(service.send(:stage_job_status, ["finished", "pipelineErrored", "userErrored"])).to eq("userErrored")
    end

    it "reports pipelineErrored when there is no user error" do
      expect(service.send(:stage_job_status, ["finished", "pipelineErrored"])).to eq("pipelineErrored")
    end

    it "reports inProgress when any step is in progress" do
      expect(service.send(:stage_job_status, ["finished", "inProgress"])).to eq("inProgress")
    end

    it "reports inProgress for the mixed notStarted + finished case" do
      expect(service.send(:stage_job_status, ["notStarted", "finished"])).to eq("inProgress")
    end

    it "reports notStarted when nothing has started" do
      expect(service.send(:stage_job_status, ["notStarted", "notStarted"])).to eq("notStarted")
    end

    it "reports finished when every step finished" do
      expect(service.send(:stage_job_status, ["finished", "finished"])).to eq("finished")
    end

    it "returns nil when no arm matches (no recognized statuses)" do
      expect(service.send(:stage_job_status, [])).to be_nil
      expect(service.send(:stage_job_status, ["mystery"])).to be_nil
    end
  end

  describe "#pipeline_job_status" do
    let(:finished_stage) { { jobStatus: "finished" } }

    it "downgrades a finished run to inProgress when stages are still missing" do
      svc = build_service(all_dag_jsons: [{}, {}], see_experimental: false)
      expect(svc.send(:pipeline_job_status, [finished_stage])).to eq("inProgress")
    end

    it "keeps finished once all 3 non-experimental stages are present" do
      svc = build_service(all_dag_jsons: [{}, {}, {}], see_experimental: false)
      expect(svc.send(:pipeline_job_status, [finished_stage])).to eq("finished")
    end

    it "requires 4 stages when experimental output is visible" do
      svc = build_service(all_dag_jsons: [{}, {}, {}], see_experimental: true)
      expect(svc.send(:pipeline_job_status, [finished_stage])).to eq("inProgress")

      svc_full = build_service(all_dag_jsons: [{}, {}, {}, {}], see_experimental: true)
      expect(svc_full.send(:pipeline_job_status, [finished_stage])).to eq("finished")
    end

    it "passes a non-finished status straight through regardless of stage count" do
      svc = build_service(all_dag_jsons: [{}], see_experimental: false)
      expect(svc.send(:pipeline_job_status, [{ jobStatus: "notStarted" }])).to eq("notStarted")
    end
  end

  describe "#file_info" do
    let(:known_path) { "samples/1/2/results/out.fa" }

    it "uses the catalogued display name and url when the file is known" do
      info = service.send(
        :file_info,
        "s3://bucket/#{known_path}",
        known_path => { display_name: "Nice Name", url: "https://signed" }
      )
      expect(info).to eq(displayName: "Nice Name", url: "https://signed")
    end

    it "falls back to the basename and a nil url when the file is unknown" do
      info = service.send(:file_info, "s3://bucket/#{known_path}", {})
      expect(info).to eq(displayName: "out.fa", url: nil)
    end
  end

  describe "#s3_path_to_file" do
    it "rebases onto sfn_results_path for a step-function run" do
      pr = double("pipeline_run", step_function?: true, sfn_results_path: "s3://bucket/sfn/results")
      svc = build_service(pipeline_run: pr)

      expect(svc.send(:s3_path_to_file, "dir/out.fa", "s3://ignored")).to eq("s3://bucket/sfn/results/out.fa")
    end

    it "joins onto the given dag directory for a legacy dag run" do
      pr = double("pipeline_run", step_function?: false)
      svc = build_service(pipeline_run: pr)

      expect(svc.send(:s3_path_to_file, "out.fa", "s3://bucket/dag")).to eq("s3://bucket/dag/out.fa")
    end
  end

  describe "#populate_nodes_with_edges" do
    it "records output edges for :from, input edges for :to, and skips absent ends" do
      stages = [
        { steps: [{ inputEdges: [], outputEdges: [] }, { inputEdges: [], outputEdges: [] }] },
        { steps: [{ inputEdges: [], outputEdges: [] }] },
      ]
      edges = [
        # no :from -- only the :to arm applies
        { to: { stageIndex: 0, stepIndex: 0 } },
        { from: { stageIndex: 0, stepIndex: 0 }, to: { stageIndex: 1, stepIndex: 0 } },
        # no :to -- only the :from arm applies
        { from: { stageIndex: 0, stepIndex: 1 } },
      ]

      service.send(:populate_nodes_with_edges, stages, edges)

      expect(stages[0][:steps][0][:inputEdges]).to eq([0])
      expect(stages[0][:steps][0][:outputEdges]).to eq([1])
      expect(stages[0][:steps][1][:outputEdges]).to eq([2])
      expect(stages[0][:steps][1][:inputEdges]).to eq([])
      expect(stages[1][:steps][0][:inputEdges]).to eq([1])
    end
  end

  describe "#remove_host_filtering_urls" do
    it "blanks urls for host-filtering targets, sourceless edges and stage-0 additional output" do
      edges = [
        # to host filtering (stage 0)
        { to: { stageIndex: 0, stepIndex: 0 }, from: { stageIndex: 0, stepIndex: 1 }, files: [{ url: "a" }] },
        # from nowhere
        { to: { stageIndex: 2, stepIndex: 0 }, from: nil, files: [{ url: "b" }] },
        # stage-0 additional output (from stage 0, no :to)
        { to: nil, from: { stageIndex: 0, stepIndex: 0 }, files: [{ url: "c" }] },
        # untouched: later stage, has both ends
        { to: { stageIndex: 2, stepIndex: 0 }, from: { stageIndex: 1, stepIndex: 0 }, files: [{ url: "d" }] },
        # untouched: additional output from a later stage
        { to: nil, from: { stageIndex: 1, stepIndex: 0 }, files: [{ url: "e" }] },
      ]

      service.send(:remove_host_filtering_urls, edges)

      expect(edges.map { |e| e[:files].first[:url] }).to eq([nil, nil, nil, "d", "e"])
    end
  end

  describe "#modify_step_name" do
    it "strips a trailing _out and titleizes" do
      expect(service.send(:modify_step_name, "czid_dedup_out")).to eq("Czid Dedup")
    end

    it "leaves names without the suffix alone apart from titleizing" do
      expect(service.send(:modify_step_name, "kallisto")).to eq("Kallisto")
    end
  end

  describe "#input_output_to_file_paths" do
    it "wraps a from-only (non-array) entry and de-duplicates identical input/outputs" do
      svc = build_service
      allow(svc).to receive(:file_path_to_inputting_steps).and_return(
        "path/shared.fa" => [{ to: { stageIndex: 0, stepIndex: 1 } }]
      )
      allow(svc).to receive(:file_path_to_outputting_step).and_return(
        "path/shared.fa" => { from: { stageIndex: 0, stepIndex: 0 } },
        "path/only_from.fa" => { from: { stageIndex: 1, stepIndex: 0 } }
      )

      result = svc.send(:input_output_to_file_paths)

      merged_key = { to: { stageIndex: 0, stepIndex: 1 }, from: { stageIndex: 0, stepIndex: 0 } }.to_json
      from_only_key = { from: { stageIndex: 1, stepIndex: 0 } }.to_json

      expect(result[merged_key]).to eq(["path/shared.fa"])
      expect(result[from_only_key]).to eq(["path/only_from.fa"])
    end
  end
end

# frozen_string_literal: true

require "rails_helper"

# Branch sweep for SfnSingleStagePipelineDataService. The existing spec drives one
# happy-path ONT graph end to end, which only ever takes one arm of most of the
# graph-building conditionals. This file exercises the individual builder methods
# against hand-built inputs so both arms of each run.
#
# The service's constructor does S3 + Open3 work, so instances are built with
# `allocate` and the four instance variables the builders actually read
# (@analysis_type, @analysis_run, @wdl_info, @result_files,
# @remove_host_filtering_urls). No application code is touched.
#
# Targeted arms: pipeline_job_status (all six outcomes), update_step_keys (the
# non-nanopore skip and each key?-guarded rename), redefine_job_status (every
# `when` plus the unmatched fall-through and the killed-run ternary),
# analysis_run_status (both technologies), add_output_files_to_steps,
# map_files_to_output_steps, create_edges, populate_nodes_with_edges,
# find_file_map_key, get_result_file_data, retrieve_step_inputs,
# map_output_files_to_sources url redaction, parse_wdl failure,
# single_stage_pipeline_step_statuses (parsed / unparseable / absent) and
# set_analysis_run (both model lookups).
RSpec.describe SfnSingleStagePipelineDataService do
  let(:nanopore) { PipelineRun::TECHNOLOGY_INPUT[:nanopore] }

  def build_service(analysis_type: nil, analysis_run: nil, wdl_info: {}, result_files: {}, redact: false)
    svc = described_class.allocate
    svc.instance_variable_set(:@analysis_type, analysis_type || nanopore)
    svc.instance_variable_set(:@analysis_run, analysis_run)
    svc.instance_variable_set(:@wdl_info, wdl_info)
    svc.instance_variable_set(:@result_files, result_files)
    svc.instance_variable_set(:@remove_host_filtering_urls, redact)
    svc
  end

  let(:service) { build_service }

  describe "#pipeline_job_status precedence ladder" do
    it "reports userErrored when any step user-errored (highest precedence)" do
      expect(service.pipeline_job_status(%w[finished userErrored pipelineErrored])).to eq("userErrored")
    end

    it "reports pipelineErrored when a pipeline error is the worst status" do
      expect(service.pipeline_job_status(%w[finished pipelineErrored notStarted])).to eq("pipelineErrored")
    end

    it "reports inProgress when a step is actively running" do
      expect(service.pipeline_job_status(%w[finished inProgress])).to eq("inProgress")
    end

    it "reports inProgress for a partially-run pipeline (notStarted AND finished)" do
      # The second half of the `||`: nothing is literally inProgress, but the mix of
      # started and unstarted steps means the run is underway.
      expect(service.pipeline_job_status(%w[notStarted finished])).to eq("inProgress")
    end

    it "reports notStarted when nothing has run yet" do
      expect(service.pipeline_job_status(%w[notStarted notStarted])).to eq("notStarted")
    end

    it "reports finished when every step finished" do
      expect(service.pipeline_job_status(%w[finished finished])).to eq("finished")
    end

    it "falls back to inProgress for an empty/unrecognized status set" do
      expect(service.pipeline_job_status([])).to eq("inProgress")
    end
  end

  describe "#update_step_keys" do
    it "leaves the statuses untouched for a non-nanopore analysis type" do
      svc = build_service(analysis_type: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      statuses = { "refined_taxon_count_out" => { "status" => "uploaded" } }

      expect(svc.update_step_keys(statuses)).to eq("refined_taxon_count_out" => { "status" => "uploaded" })
    end

    it "renames every legacy nanopore key that is present" do
      statuses = {
        "refined_taxon_count_out" => { "status" => "uploaded" },
        "contig_summary_out" => { "status" => "uploaded" },
        "refined_taxid_locator_out" => { "status" => "running" },
        "coverage_viz_out" => { "status" => "instantiated" },
      }

      result = service.update_step_keys(statuses)

      expect(result.keys).to contain_exactly("CombineTaxonCounts", "CombineJson",
                                             "GenerateTaxidLocator", "GenerateCoverageViz")
      expect(result["GenerateTaxidLocator"]).to eq("status" => "running")
    end

    it "renames only the legacy keys that exist (each key? guard's false arm)" do
      statuses = { "contig_summary_out" => { "status" => "uploaded" }, "RunHostFilter" => { "status" => "uploaded" } }

      result = service.update_step_keys(statuses)

      expect(result.keys).to contain_exactly("CombineJson", "RunHostFilter")
      expect(result).not_to have_key("CombineTaxonCounts")
      expect(result).not_to have_key("GenerateCoverageViz")
    end
  end

  describe "#redefine_job_status" do
    let(:pipeline_run) { create(:pipeline_run, sfn_execution_arn: "fake-arn") }
    let(:svc) { build_service(analysis_run: pipeline_run) }

    it "maps instantiated to notStarted" do
      expect(svc.redefine_job_status("instantiated")).to eq("notStarted")
    end

    it "maps a missing status to notStarted (the nil alternative)" do
      expect(svc.redefine_job_status(nil)).to eq("notStarted")
    end

    it "maps uploaded to finished" do
      expect(svc.redefine_job_status("uploaded")).to eq("finished")
    end

    it "maps pipeline_errored to pipelineErrored" do
      expect(svc.redefine_job_status("pipeline_errored")).to eq("pipelineErrored")
    end

    it "maps errored and user_errored to userErrored" do
      expect(svc.redefine_job_status("errored")).to eq("userErrored")
      expect(svc.redefine_job_status("user_errored")).to eq("userErrored")
    end

    it "maps running to inProgress for a live run (the non-failed ternary arm)" do
      allow(pipeline_run).to receive(:job_status).and_return(PipelineRun::STATUS_READY)
      expect(svc.redefine_job_status("running")).to eq("inProgress")
    end

    it "maps finished_running to pipelineErrored when the run itself failed (the failed ternary arm)" do
      allow(pipeline_run).to receive(:job_status).and_return(WorkflowRun::STATUS[:failed])
      # The ternary result is now returned (previously it was discarded by a trailing
      # literal, so a killed run wrongly stayed inProgress -- alpha bug 29 dead-code fix).
      expect(svc.redefine_job_status("finished_running")).to eq("pipelineErrored")
    end

    it "greens every step once the run succeeded, even for a non-uploaded literal" do
      # alpha bug 29: a completed ONT run (PipelineRun job_status CHECKED) has no per-step
      # stage arg and often no status file, so any step must still render green.
      allow(pipeline_run).to receive(:job_status).and_return(PipelineRun::STATUS_CHECKED)
      expect(svc.redefine_job_status(nil)).to eq("finished")
      expect(svc.redefine_job_status("instantiated")).to eq("finished")
      expect(svc.redefine_job_status("something_new")).to eq("finished")
    end

    it "does not green a step when the run failed" do
      allow(pipeline_run).to receive(:job_status).and_return(WorkflowRun::STATUS[:failed])
      expect(svc.redefine_job_status("something_new")).not_to eq("finished")
      expect(svc.redefine_job_status("running")).to eq("pipelineErrored")
    end

    it "maps an unknown literal to inProgress rather than nil (no gray fall-through)" do
      allow(pipeline_run).to receive(:job_status).and_return(PipelineRun::STATUS_READY)
      expect(svc.redefine_job_status("something_new")).to eq("inProgress")
    end
  end

  describe "#analysis_run_status" do
    it "reads job_status for a nanopore pipeline run" do
      pipeline_run = create(:pipeline_run, job_status: PipelineRun::STATUS_CHECKED, sfn_execution_arn: "fake-arn")
      svc = build_service(analysis_run: pipeline_run)

      expect(svc.analysis_run_status).to eq(PipelineRun::STATUS_CHECKED)
    end

    it "reads status for a non-nanopore workflow run (the else arm)" do
      workflow_run = create(:workflow_run, status: WorkflowRun::STATUS[:succeeded])
      svc = build_service(analysis_type: WorkflowRun::WORKFLOW[:consensus_genome], analysis_run: workflow_run)

      expect(svc.analysis_run_status).to eq(WorkflowRun::STATUS[:succeeded])
    end
  end

  describe "#set_analysis_run" do
    it "looks up a PipelineRun for nanopore" do
      pipeline_run = create(:pipeline_run, sfn_execution_arn: "fake-arn")
      svc = described_class.allocate
      svc.set_analysis_run(pipeline_run.id, nanopore)

      expect(svc.instance_variable_get(:@analysis_run)).to eq(pipeline_run)
    end

    it "looks up a WorkflowRun for anything else (the case else arm)" do
      workflow_run = create(:workflow_run)
      svc = described_class.allocate
      svc.set_analysis_run(workflow_run.id, WorkflowRun::WORKFLOW[:consensus_genome])

      expect(svc.instance_variable_get(:@analysis_run)).to eq(workflow_run)
    end
  end

  describe "#add_output_files_to_steps" do
    it "attaches a file's data to its producing step" do
      steps = [{ outputFiles: [] }, { outputFiles: [] }]
      file_source_map = { "a" => { from: { stageIndex: 0, stepIndex: 1 }, data: { displayName: "a.txt" } } }

      result = service.add_output_files_to_steps(steps, file_source_map)

      expect(result[1][:outputFiles]).to eq([{ displayName: "a.txt" }])
      expect(result[0][:outputFiles]).to be_empty
    end

    it "skips files that have no producing step (the from-blank arm)" do
      steps = [{ outputFiles: [] }]
      file_source_map = { "a" => { data: { displayName: "a.txt" }, to: [] } }

      result = service.add_output_files_to_steps(steps, file_source_map)

      expect(result[0][:outputFiles]).to be_empty
    end
  end

  describe "#map_files_to_output_steps" do
    it "appends the consuming step to a file already in the source map" do
      file_source_map = { "validated_fastq" => { name: "validated_fastq", to: [] } }
      steps = [{ inputFiles: [{ name: "validated_fastq" }] }]

      result = service.map_files_to_output_steps(steps, file_source_map)

      expect(result["validated_fastq"][:to]).to eq([{ stageIndex: 0, stepIndex: 0 }])
      # inputFiles is consumed and removed from the step.
      expect(steps[0]).not_to have_key(:inputFiles)
    end

    it "creates a source-less entry for an input file no step produces (the nil-key arm)" do
      file_source_map = {}
      steps = [{ inputFiles: [{ name: "workflow_input_fastq" }] }]

      result = service.map_files_to_output_steps(steps, file_source_map)

      entry = result["workflow_input_fastq"]
      expect(entry[:data]).to eq(displayName: "workflow_input_fastq", url: nil)
      expect(entry[:to]).to eq([{ stageIndex: 0, stepIndex: 0 }])
      expect(entry).not_to have_key(:from)
    end
  end

  describe "#create_edges" do
    it "builds a from+to edge for a file that is produced and consumed" do
      file_source_map = {
        "a" => {
          from: { stageIndex: 0, stepIndex: 0 },
          to: [{ stageIndex: 0, stepIndex: 1 }],
          data: { displayName: "a.txt" },
        },
      }

      edges = service.create_edges(file_source_map)

      expect(edges.length).to eq(1)
      expect(edges[0][:from]).to eq(stageIndex: 0, stepIndex: 0)
      expect(edges[0][:to]).to eq(stageIndex: 0, stepIndex: 1)
      expect(edges[0][:files]).to eq([{ displayName: "a.txt" }])
    end

    it "builds a to-only edge for a workflow input (no :from key)" do
      file_source_map = {
        "in" => { to: [{ stageIndex: 0, stepIndex: 0 }], data: { displayName: "in.fastq" } },
      }

      edges = service.create_edges(file_source_map)

      expect(edges.length).to eq(1)
      expect(edges[0]).not_to have_key(:from)
      expect(edges[0][:to]).to eq(stageIndex: 0, stepIndex: 0)
    end

    it "builds a from-only edge for a terminal output (empty :to)" do
      file_source_map = {
        "out" => { from: { stageIndex: 0, stepIndex: 2 }, to: [], data: { displayName: "out.txt" } },
      }

      edges = service.create_edges(file_source_map)

      expect(edges.length).to eq(1)
      expect(edges[0][:from]).to eq(stageIndex: 0, stepIndex: 2)
      expect(edges[0][:to]).to be_nil
    end

    it "merges files that share the same from/to pair onto one edge" do
      shared_from = { stageIndex: 0, stepIndex: 0 }
      shared_to = { stageIndex: 0, stepIndex: 1 }
      file_source_map = {
        "a" => { from: shared_from, to: [shared_to], data: { displayName: "a.txt" } },
        "b" => { from: shared_from, to: [shared_to], data: { displayName: "b.txt" } },
      }

      edges = service.create_edges(file_source_map)

      expect(edges.length).to eq(1)
      expect(edges[0][:files].pluck(:displayName)).to eq(["a.txt", "b.txt"])
    end
  end

  describe "#populate_nodes_with_edges" do
    it "records the edge index on both endpoints and marks it intra-stage" do
      steps = [{ inputEdges: [], outputEdges: [] }, { inputEdges: [], outputEdges: [] }]
      edges = [{ from: { stageIndex: 0, stepIndex: 0 }, to: { stageIndex: 0, stepIndex: 1 } }]

      service.populate_nodes_with_edges(steps, edges)

      expect(steps[0][:outputEdges]).to eq([0])
      expect(steps[1][:inputEdges]).to eq([0])
      expect(edges[0][:isIntraStage]).to be(true)
    end

    it "handles a from-only edge without marking it intra-stage" do
      steps = [{ inputEdges: [], outputEdges: [] }]
      edges = [{ from: { stageIndex: 0, stepIndex: 0 } }]

      service.populate_nodes_with_edges(steps, edges)

      expect(steps[0][:outputEdges]).to eq([0])
      expect(steps[0][:inputEdges]).to be_empty
      expect(edges[0]).not_to have_key(:isIntraStage)
    end

    it "handles a to-only edge without marking it intra-stage" do
      steps = [{ inputEdges: [], outputEdges: [] }]
      edges = [{ to: { stageIndex: 0, stepIndex: 0 } }]

      service.populate_nodes_with_edges(steps, edges)

      expect(steps[0][:inputEdges]).to eq([0])
      expect(steps[0][:outputEdges]).to be_empty
      expect(edges[0]).not_to have_key(:isIntraStage)
    end
  end

  describe "#find_file_map_key" do
    it "returns the filename directly when it keys the source map" do
      map = { "validated_fastq" => { name: "validated_fastq" } }
      expect(service.find_file_map_key("validated_fastq", map)).to eq("validated_fastq")
    end

    it "falls through to the deep search for an _out_ style name that is not a key" do
      map = { "validated_fastq" => { name: "validated_fastq", internal_name: "step_out_1" } }
      expect(service.find_file_map_key("step_out_1", map)).to eq("validated_fastq")
    end

    it "deep-searches by :name for a plain name that is not a key" do
      map = { "k" => { name: "some_output", internal_name: "other" } }
      expect(service.find_file_map_key("some_output", map)).to eq("some_output")
    end

    it "returns nil when nothing matches" do
      map = { "k" => { name: "some_output", internal_name: "other" } }
      expect(service.find_file_map_key("unknown_input", map)).to be_nil
    end
  end

  describe "#get_result_file_data" do
    let(:svc) do
      build_service(result_files: {
                      "validated.fastq" => { displayName: "validated.fastq", url: "s3://b/validated.fastq" },
                    })
    end

    it "returns the entry keyed by the exact file name" do
      expect(svc.get_result_file_data("validated.fastq")[:url]).to eq("s3://b/validated.fastq")
    end

    it "falls back to the basename of a full path (the elsif arm)" do
      expect(svc.get_result_file_data("some/dir/validated.fastq")[:url]).to eq("s3://b/validated.fastq")
    end

    it "returns a url-less placeholder for an unknown file (the else arm)" do
      expect(svc.get_result_file_data("missing.txt")).to eq(displayName: "missing.txt", url: nil)
    end
  end

  describe "#retrieve_step_inputs" do
    let(:wdl_info) do
      {
        "inputs" => { "input_fastq" => "File", "docker_image_id" => "String" },
        "task_inputs" => {
          "RunQualityFilter" => ["WorkflowInput.input_fastq", "WorkflowInput.docker_image_id", "RunValidateInput.validated_fastq"],
        },
        "basenames" => { "RunValidateInput.validated_fastq" => "dir/validated.fastq" },
      }
    end

    it "splits workflow inputs into files and variables and resolves step outputs as files" do
      variables, files = build_service(wdl_info: wdl_info).retrieve_step_inputs("RunQualityFilter")

      # WorkflowInput.input_fastq -> typed "File" from inputs -> files (case "File").
      # WorkflowInput.docker_image_id -> typed "String" -> variables (case else).
      # RunValidateInput.validated_fastq -> not a workflow input -> stays "File" and
      # picks up the basename of the produced file.
      expect(variables.pluck(:name)).to eq(["docker_image_id"])
      expect(files.pluck(:name)).to eq(%w[input_fastq validated_fastq])
      expect(files.detect { |f| f[:name] == "validated_fastq" }[:file]).to eq("validated.fastq")
    end
  end

  describe "#map_output_files_to_sources url redaction" do
    let(:wdl_info) do
      {
        "task_names" => %w[RunValidateInput RunAssembly],
        "basenames" => {
          "RunValidateInput.validated_fastq" => "validated.fastq",
          "RunAssembly.contigs" => "contigs.fasta",
        },
      }
    end
    let(:result_files) do
      {
        "validated.fastq" => { displayName: "validated.fastq", url: "s3://b/validated.fastq" },
        "contigs.fasta" => { displayName: "contigs.fasta", url: "s3://b/contigs.fasta" },
      }
    end

    it "keeps every url when redaction is off" do
      map = build_service(wdl_info: wdl_info, result_files: result_files, redact: false)
            .map_output_files_to_sources

      expect(map["validated_fastq"][:data][:url]).to eq("s3://b/validated.fastq")
      expect(map["contigs"][:data][:url]).to eq("s3://b/contigs.fasta")
    end

    it "nils urls only for pre-filtered steps when redaction is on" do
      map = build_service(wdl_info: wdl_info, result_files: result_files, redact: true)
            .map_output_files_to_sources

      # RunValidateInput is in PRE_FILTERED_STEPS; RunAssembly is not.
      expect(map["validated_fastq"][:data][:url]).to be_nil
      expect(map["contigs"][:data][:url]).to eq("s3://b/contigs.fasta")
      expect(map["contigs"][:from]).to eq(stageIndex: 0, stepIndex: 1)
    end
  end

  describe "#parse_wdl" do
    it "returns the parsed JSON when the parser exits successfully" do
      status = instance_double("Process::Status", success?: true)
      allow(Open3).to receive(:capture3).and_return(['{"task_names":["A"]}', "", status])

      expect(service.parse_wdl("workflow {}")).to eq("task_names" => ["A"])
    end

    it "raises ParseWdlError carrying stderr when the parser fails" do
      status = instance_double("Process::Status", success?: false)
      allow(Open3).to receive(:capture3).and_return(["", "boom on line 3", status])

      expect { service.parse_wdl("workflow {}") }
        .to raise_error(SfnSingleStagePipelineDataService::ParseWdlError, /boom on line 3/)
    end
  end

  describe "#single_stage_pipeline_step_statuses" do
    let(:pipeline_run) { create(:pipeline_run, sfn_execution_arn: "fake-arn") }
    let(:svc) { build_service(analysis_run: pipeline_run) }

    before { allow(pipeline_run).to receive(:sfn_results_path).and_return("s3://bucket/results") }

    it "parses the status2.json when it exists" do
      allow(S3Util).to receive(:get_s3_file)
        .with("s3://bucket/results/long_read_mngs_status2.json")
        .and_return('{"RunValidateInput":{"status":"uploaded"}}')

      expect(svc.single_stage_pipeline_step_statuses).to eq("RunValidateInput" => { "status" => "uploaded" })
    end

    it "returns an empty hash when the status file is not valid JSON (rescue arm)" do
      allow(S3Util).to receive(:get_s3_file).and_return("not json at all")

      expect(svc.single_stage_pipeline_step_statuses).to eq({})
    end

    it "returns an empty hash when the status file is absent" do
      allow(S3Util).to receive(:get_s3_file).and_return(nil)

      expect(svc.single_stage_pipeline_step_statuses).to eq({})
    end
  end
end

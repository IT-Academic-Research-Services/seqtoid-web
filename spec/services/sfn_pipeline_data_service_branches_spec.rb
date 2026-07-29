require "rails_helper"

# Branch coverage for SfnPipelineDataService's private graph-building helpers. The sibling
# sfn_pipeline_data_service_spec drives one happy-path pipeline end-to-end (two stages, a
# well-formed WDL, every file resolvable), so the defensive arms -- unresolvable file names,
# edges with no source, steps with no status, the killed-pipeline status remapping, the
# host-filtering URL scrubbing -- are never taken. These examples build the service with
# `allocate` and set only the instance state each helper reads, so no S3/WDL parsing is
# involved.
RSpec.describe SfnPipelineDataService do
  # Build the service without running #initialize (which would hit S3 for the WDLs).
  def service(ivars = {})
    svc = described_class.allocate
    defaults = {
      "@stages_wdl_info" => [],
      "@stage_names" => [],
      "@stage_job_statuses" => [],
      "@result_files" => {},
      "@host_filtering_stage_index" => nil,
      "@see_experimental" => false,
      "@remove_host_filtering_urls" => false,
    }
    defaults.merge(ivars).each { |name, value| svc.instance_variable_set(name, value) }
    svc
  end

  describe "#unprefix" do
    it "keeps everything after an _out_ prefix" do
      expect(service.send(:unprefix, "gsnap_out_taxid_annot_fasta")).to eq("taxid_annot_fasta")
    end

    it "keeps everything after an _in_ prefix" do
      expect(service.send(:unprefix, "host_filter_in_fastqs")).to eq("fastqs")
    end

    it "returns the basename for a path-like name" do
      expect(service.send(:unprefix, "s3://bucket/dir/file.fasta")).to eq("file.fasta")
    end

    it "returns the name untouched when it carries no prefix at all" do
      expect(service.send(:unprefix, "assembly")).to eq("assembly")
    end

    it "joins every piece after the first when the prefix repeats" do
      expect(service.send(:unprefix, "a_out_b_out_c")).to eq("bc")
    end
  end

  describe "#get_result_file_data" do
    let(:svc) { service("@result_files" => { "contigs.fasta" => { displayName: "contigs.fasta", url: "s3://x" } }) }

    it "returns the exact result-file entry when the name matches" do
      expect(svc.send(:get_result_file_data, "contigs.fasta")).to eq(displayName: "contigs.fasta", url: "s3://x")
    end

    it "falls back to matching on the basename" do
      expect(svc.send(:get_result_file_data, "dir/contigs.fasta")).to eq(displayName: "contigs.fasta", url: "s3://x")
    end

    it "returns an undownloadable placeholder when nothing matches" do
      expect(svc.send(:get_result_file_data, "missing.fasta")).to eq(displayName: "missing.fasta", url: nil)
    end
  end

  describe "#redefine_job_status" do
    it "maps each known step status to its display status" do
      svc = service
      expect(svc.send(:redefine_job_status, "instantiated", nil)).to eq("notStarted")
      expect(svc.send(:redefine_job_status, nil, nil)).to eq("notStarted")
      expect(svc.send(:redefine_job_status, "uploaded", nil)).to eq("finished")
      expect(svc.send(:redefine_job_status, "pipeline_errored", nil)).to eq("pipelineErrored")
      expect(svc.send(:redefine_job_status, "errored", nil)).to eq("userErrored")
      expect(svc.send(:redefine_job_status, "user_errored", nil)).to eq("userErrored")
    end

    it "reports a running step as in progress while its stage is healthy" do
      expect(service.send(:redefine_job_status, "running", PipelineRunStage::STATUS_STARTED)).to eq("inProgress")
      expect(service.send(:redefine_job_status, "finished_running", PipelineRunStage::STATUS_STARTED)).to eq("inProgress")
    end

    it "reports a running step as pipeline-errored once its stage has failed" do
      expect(service.send(:redefine_job_status, "running", PipelineRunStage::STATUS_FAILED)).to eq("pipelineErrored")
    end

    it "returns nil for a status it does not know about" do
      expect(service.send(:redefine_job_status, "something_new", nil)).to be_nil
    end
  end

  describe "#stage_job_status" do
    it "prefers userErrored over every other status" do
      expect(service.send(:stage_job_status, %w[finished userErrored pipelineErrored])).to eq("userErrored")
    end

    it "reports pipelineErrored when no step user-errored" do
      expect(service.send(:stage_job_status, %w[finished pipelineErrored])).to eq("pipelineErrored")
    end

    it "reports inProgress when any step is in progress" do
      expect(service.send(:stage_job_status, %w[finished inProgress])).to eq("inProgress")
    end

    it "reports inProgress for a partially finished stage" do
      expect(service.send(:stage_job_status, %w[notStarted finished])).to eq("inProgress")
    end

    it "reports notStarted when nothing has run yet" do
      expect(service.send(:stage_job_status, %w[notStarted notStarted])).to eq("notStarted")
    end

    it "reports finished when every step finished" do
      expect(service.send(:stage_job_status, %w[finished finished])).to eq("finished")
    end

    it "falls back to inProgress for an empty status list" do
      expect(service.send(:stage_job_status, [])).to eq("inProgress")
    end
  end

  describe "#pipeline_job_status" do
    let(:finished_stages) { [{ jobStatus: "finished" }] }

    it "downgrades a finished pipeline to inProgress while stages are still missing" do
      svc = service("@stages_wdl_info" => [{}, {}], "@see_experimental" => false)
      expect(svc.send(:pipeline_job_status, finished_stages)).to eq("inProgress")
    end

    it "reports finished once all three non-experimental stages are present" do
      svc = service("@stages_wdl_info" => [{}, {}, {}], "@see_experimental" => false)
      expect(svc.send(:pipeline_job_status, finished_stages)).to eq("finished")
    end

    it "requires a fourth stage when experimental stages are visible" do
      svc = service("@stages_wdl_info" => [{}, {}, {}], "@see_experimental" => true)
      expect(svc.send(:pipeline_job_status, finished_stages)).to eq("inProgress")

      svc4 = service("@stages_wdl_info" => [{}, {}, {}, {}], "@see_experimental" => true)
      expect(svc4.send(:pipeline_job_status, finished_stages)).to eq("finished")
    end

    it "passes an unfinished status straight through without the stage-count check" do
      svc = service("@stages_wdl_info" => [{}], "@see_experimental" => false)
      expect(svc.send(:pipeline_job_status, [{ jobStatus: "notStarted" }])).to eq("notStarted")
    end
  end

  describe "#retrieve_step_inputs" do
    let(:stage_info) do
      {
        "task_inputs" => { "RunAssembly" => ["WorkflowInput.min_contig_length", "WorkflowInput.fastqs", "RunSubsample.subsampled_fa"] },
        "inputs" => { "min_contig_length" => "Int", "fastqs" => "File" },
        "basenames" => { "RunSubsample.subsampled_fa" => "dir/subsampled.fa" },
      }
    end

    it "splits workflow-level inputs into variables and files and treats task outputs as files" do
      variables, files = service.send(:retrieve_step_inputs, stage_info, "RunAssembly")

      expect(variables).to eq([{ name: "min_contig_length", type: "Int" }])
      expect(files).to contain_exactly(
        { name: "fastqs", type: "File" },
        { name: "subsampled_fa", type: "File", file: "subsampled.fa" }
      )
    end
  end

  describe "#collect_step_output_files" do
    it "buckets each declared output under the task that produces it" do
      stage_info = {
        "task_names" => ["RunAssembly", "RunIdle"],
        "outputs" => { "assembly_out_contigs" => "RunAssembly.contigs" },
        "basenames" => { "RunAssembly.contigs" => "contigs.fasta" },
      }

      output_map = service.send(:collect_step_output_files, stage_info)

      expect(output_map["RunIdle"]).to eq([])
      expect(output_map["RunAssembly"]).to eq(
        [{ name: "assembly_out_contigs", internal_name: "contigs", unprefixed_name: "contigs", file: "contigs.fasta" }]
      )
    end
  end

  describe "#add_output_files_to_steps" do
    it "attaches sourced files to their producing step and ignores unsourced files" do
      stages = [{ steps: [{ outputFiles: [] }] }]
      file_source_map = {
        "sourced" => { from: { stageIndex: 0, stepIndex: 0 }, data: { displayName: "a.fa" } },
        "unsourced" => { data: { displayName: "b.fa" } },
      }

      result = service.send(:add_output_files_to_steps, stages, file_source_map)

      expect(result[0][:steps][0][:outputFiles]).to eq([{ displayName: "a.fa" }])
    end
  end

  describe "#find_file_map_key" do
    it "matches an exact key first" do
      map = { "contigs.fa" => { unprefixed_name: "contigs.fa" } }
      expect(service.send(:find_file_map_key, "contigs.fa", map)).to eq("contigs.fa")
    end

    it "matches a prefixed name against its unprefixed key" do
      map = { "contigs" => { unprefixed_name: "contigs" } }
      expect(service.send(:find_file_map_key, "assembly_out_contigs", map)).to eq("contigs")
    end

    it "digs through the entry names when neither the raw nor the unprefixed key matches" do
      map = { "some_key" => { name: "gsnap_out_hits", internal_name: "hits", unprefixed_name: "some_key" } }
      expect(service.send(:find_file_map_key, "hits", map)).to eq("some_key")
    end

    it "digs by unprefixed name when the unprefixed name is not itself a map key" do
      map = { "stored_key" => { name: "other", internal_name: "other", unprefixed_name: "hits" } }
      # The entry is stored under "stored_key" but reports itself as "hits", and
      # FILE_SOURCE_MAP_KEY is :unprefixed_name -- so the dig returns "hits".
      expect(service.send(:find_file_map_key, "gsnap_out_hits", map)).to eq("hits")
    end

    it "returns nil when nothing in the map can be matched" do
      map = { "stored_key" => { name: "other", internal_name: "other", unprefixed_name: "other" } }
      expect(service.send(:find_file_map_key, "unknown_file", map)).to be_nil
    end
  end

  describe "#map_files_to_output_steps" do
    it "records the consuming step on a known file and invents an entry for an unknown one" do
      stages = [{
        steps: [
          { inputFiles: [{ name: "contigs" }, { name: "mystery" }] },
        ],
      }]
      file_source_map = { "contigs" => { unprefixed_name: "contigs", to: [] } }

      result = service.send(:map_files_to_output_steps, stages, file_source_map)

      expect(result["contigs"][:to]).to eq([{ stageIndex: 0, stepIndex: 0 }])
      expect(result["mystery"]).to eq(
        name: "mystery", data: { displayName: "mystery", url: nil }, to: [{ stageIndex: 0, stepIndex: 0 }]
      )
      # inputFiles is consumed and removed from the step once mapped.
      expect(stages[0][:steps][0]).not_to have_key(:inputFiles)
    end
  end

  describe "#create_edges" do
    it "creates one edge per destination and carries the source when there is one" do
      file_source_map = {
        "a" => { data: { displayName: "a" }, from: { stageIndex: 0, stepIndex: 0 }, to: [{ stageIndex: 0, stepIndex: 1 }] },
      }

      edges = service.send(:create_edges, file_source_map)

      expect(edges).to eq([{ to: { stageIndex: 0, stepIndex: 1 }, from: { stageIndex: 0, stepIndex: 0 }, files: [{ displayName: "a" }] }])
    end

    it "creates a source-only edge for an output nothing consumes" do
      file_source_map = { "a" => { data: { displayName: "a" }, from: { stageIndex: 1, stepIndex: 0 }, to: [] } }

      edges = service.send(:create_edges, file_source_map)

      expect(edges).to eq([{ from: { stageIndex: 1, stepIndex: 0 }, files: [{ displayName: "a" }] }])
    end

    it "creates a destination-only edge for an input nothing produces" do
      file_source_map = { "a" => { data: { displayName: "a" }, to: [{ stageIndex: 0, stepIndex: 0 }] } }

      edges = service.send(:create_edges, file_source_map)

      expect(edges).to eq([{ to: { stageIndex: 0, stepIndex: 0 }, files: [{ displayName: "a" }] }])
    end

    it "merges files that travel between the same pair of steps into one edge" do
      from = { stageIndex: 0, stepIndex: 0 }
      to = { stageIndex: 0, stepIndex: 1 }
      file_source_map = {
        "a" => { data: { displayName: "a" }, from: from, to: [to] },
        "b" => { data: { displayName: "b" }, from: from, to: [to] },
      }

      edges = service.send(:create_edges, file_source_map)

      expect(edges.size).to eq(1)
      expect(edges.first[:files]).to eq([{ displayName: "a" }, { displayName: "b" }])
    end
  end

  describe "#populate_nodes_with_edges" do
    it "indexes edges onto both endpoints and flags intra-stage edges" do
      stages = [{ steps: [{ inputEdges: [], outputEdges: [] }, { inputEdges: [], outputEdges: [] }] },
                { steps: [{ inputEdges: [], outputEdges: [] }] },]
      edges = [
        { from: { stageIndex: 0, stepIndex: 0 }, to: { stageIndex: 0, stepIndex: 1 } },
        { from: { stageIndex: 0, stepIndex: 1 }, to: { stageIndex: 1, stepIndex: 0 } },
      ]

      service.send(:populate_nodes_with_edges, stages, edges)

      expect(stages[0][:steps][0][:outputEdges]).to eq([0])
      expect(stages[0][:steps][1][:inputEdges]).to eq([0])
      expect(edges[0][:isIntraStage]).to be(true)
      expect(edges[1][:isIntraStage]).to be(false)
    end

    it "handles half-open edges without touching the missing endpoint" do
      stages = [{ steps: [{ inputEdges: [], outputEdges: [] }] }]
      edges = [{ from: { stageIndex: 0, stepIndex: 0 } }, { to: { stageIndex: 0, stepIndex: 0 } }]

      service.send(:populate_nodes_with_edges, stages, edges)

      expect(stages[0][:steps][0][:outputEdges]).to eq([0])
      expect(stages[0][:steps][0][:inputEdges]).to eq([1])
      expect(edges.pluck(:isIntraStage)).to eq([false, false])
    end
  end

  describe "#remove_host_filtering_urls" do
    let(:stages) do
      [{ steps: [{ outputFiles: [{ url: "s3://pgi", key: "k" }] }] },
       { steps: [{ outputFiles: [{ url: "s3://safe", key: "k2" }] }] },]
    end

    it "scrubs the host-filtering step outputs and every edge that touches stage 0" do
      edges = [
        { to: { stageIndex: 0, stepIndex: 0 }, files: [{ url: "s3://a" }] },
        { from: { stageIndex: 0, stepIndex: 0 }, files: [{ url: "s3://b" }] },
        { from: { stageIndex: 1, stepIndex: 0 }, to: { stageIndex: 1, stepIndex: 0 }, files: [{ url: "s3://c" }] },
      ]

      service("@host_filtering_stage_index" => 0).send(:remove_host_filtering_urls, stages, edges)

      expect(stages[0][:steps][0][:outputFiles]).to eq([{ url: nil, key: nil }])
      expect(stages[1][:steps][0][:outputFiles]).to eq([{ url: "s3://safe", key: "k2" }])
      expect(edges[0][:files].first[:url]).to be_nil
      expect(edges[1][:files].first[:url]).to be_nil
      expect(edges[2][:files].first[:url]).to eq("s3://c")
    end

    it "skips the step scrub when there is no host-filtering stage but still scrubs sourceless edges" do
      edges = [{ to: { stageIndex: 1, stepIndex: 0 }, files: [{ url: "s3://c" }] }]

      service("@host_filtering_stage_index" => nil).send(:remove_host_filtering_urls, stages, edges)

      expect(stages[0][:steps][0][:outputFiles]).to eq([{ url: "s3://pgi", key: "k" }])
      # No :from at all -> the edge is scrubbed for safety.
      expect(edges[0][:files].first[:url]).to be_nil
    end
  end

  describe "#parse_wdl" do
    it "returns the parsed JSON when the parser succeeds" do
      allow(Open3).to receive(:capture3).and_return(['{"task_names":["A"]}', "", instance_double(Process::Status, success?: true)])

      expect(service.send(:parse_wdl, "version 1.0")).to eq("task_names" => ["A"])
    end

    it "raises ParseWdlError carrying stderr when the parser fails" do
      allow(Open3).to receive(:capture3).and_return(["", "bad wdl", instance_double(Process::Status, success?: false)])

      expect { service.send(:parse_wdl, "nonsense") }
        .to raise_error(SfnPipelineDataService::ParseWdlError, /bad wdl/)
    end
  end
end

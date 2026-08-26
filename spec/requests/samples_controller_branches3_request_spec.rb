require 'rails_helper'

# Branch coverage wave 3 for app/controllers/samples_controller.rb.
#
# samples_controller_spec / samples_controller_branches_spec / the coverage2+coverage3
# request specs drive the discovery, blast and fasta endpoints. The arms below are the
# ones none of them reach:
#
#   * search_suggestions: the "no sample/taxon category requested" arm that skips the
#     constrained-samples query entirely, and (under BYPASS_ES_TAXON_SEARCH) the
#     blank-query arm that leaves the hardcoded taxa unfiltered / the Taxon key absent.
#   * bulk_upload_with_metadata: the non-"web" client_type arm, the CLI
#     upgrade-required guard, the "sample created but missing required metadata gets
#     destroyed" arm, and the CLI response-shape arm (multipart upload ids instead of
#     the web bucket/path payload).
#   * show.json for a sample that HAS a pipeline run (default_pipeline_run_id present).
#   * report_v2 when the client passes an explicit pipeline_version (so the controller
#     does not backfill it from the selected run).
#   * benchmark for a non-mNGS workflow (workflow runs instead of pipeline runs).
#
# Everything each example needs (app configs, alignment configs, metadata fields) is
# created inside the example/its before block, so the file passes standalone.
RSpec.describe "Samples controller branch coverage (wave 3)", type: :request do
  create_users

  let(:short_read_mngs) { WorkflowRun::WORKFLOW[:short_read_mngs] }
  let(:consensus_genome) { WorkflowRun::WORKFLOW[:consensus_genome] }
  let(:default_index_version) { "2021-01-22" }

  describe "GET /search_suggestions" do
    before { sign_in @joe }

    it "skips the sample/taxon lookups entirely when only the project category is requested" do
      create(:project, users: [@joe], name: "Branch3 Malaria Study")
      create(:sample, project: create(:project, users: [@joe]), user: @joe, name: "Branch3 Malaria Sample")

      # The `["sample", "taxon"].any?` guard is what protects `constrained_samples`;
      # with only "project" requested the sample scope must never be built.
      expect_any_instance_of(SamplesController).not_to receive(:samples_by_domain)

      get "/search_suggestions", params: { query: "Branch3 Malaria", domain: "my_data", categories: ["project"] }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.keys).to eq(["Project"])
      expect(body.dig("Project", "results").pluck("title")).to include("Branch3 Malaria Study")
    end

    it "returns no Taxon key at all when the bypass list is enabled but the query is blank" do
      AppConfigHelper.set_app_config(AppConfig::BYPASS_ES_TAXON_SEARCH, "1")
      # The real ES search is never consulted on the bypass path.
      expect_any_instance_of(SamplesController).not_to receive(:taxon_search)

      get "/search_suggestions", params: { query: "", categories: ["taxon"] }

      expect(response).to have_http_status(:ok)
      # query blank -> the hardcoded list is never filtered -> nil -> no "Taxon" key,
      # which is what the real elasticsearch query does for an empty search.
      expect(JSON.parse(response.body)).to eq({})
    end
  end

  describe "POST /samples/bulk_upload_with_metadata" do
    let(:project) { create(:public_project, users: [@joe]) }
    let(:host_genome) { create(:host_genome) }

    let(:sample_name) { "branch3_upload_sample" }

    let(:sample_params) do
      {
        host_genome_id: host_genome.id,
        host_genome_name: host_genome.name,
        input_files_attributes: [
          {
            source_type: "local",
            source: "branch3_R1.fastq.gz",
            parts: "branch3_R1.fastq.gz",
            upload_client: "cli",
            file_type: "fastq",
          },
        ],
        name: sample_name,
        project_id: project.id,
        do_not_process: false,
        workflows: [short_read_mngs],
      }
    end

    let(:metadata_params) do
      {
        sample_name => {
          "sex" => "Female",
          "age" => 100,
          "water_control" => "No",
          "sample_type" => "CSF",
          "nucleotide_type" => "DNA",
          "collection_date" => "2020-01",
          "collection_location_v2" => { "title" => "Santa Barbara, CA", "name" => "Santa Barbara, CA" },
        },
      }
    end

    before do
      sign_in @joe
      stub_const("SAMPLES_BUCKET_NAME", "branch3-samples-bucket")
      create(:app_config, key: AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME, value: default_index_version)
      create(:alignment_config, name: AlignmentConfig.default_name)
      create(:workflow_version, workflow: AlignmentConfig::NCBI_INDEX, version: AlignmentConfig.default_name)
    end

    it "rejects a CLI older than the minimum supported version" do
      post "/samples/bulk_upload_with_metadata", params: { samples: [sample_params], metadata: metadata_params, client: "5.0.0", format: :json }

      expect(response).to have_http_status(:upgrade_required)
      expect(JSON.parse(response.body)["message"]).to eq(SamplesController::CLI_DEPRECATION_MSG)
      expect(Sample.find_by(name: sample_name)).to be_nil
    end

    it "treats a malformed / unparseable client version as outdated instead of 500ing" do
      # An un-injected dev CLI build sends client="unversioned"; Gem::Version.new used to raise
      # ArgumentError here and 500 the request. It must fall through to :upgrade_required.
      post "/samples/bulk_upload_with_metadata", params: { samples: [sample_params], metadata: metadata_params, client: "unversioned", format: :json }

      expect(response).to have_http_status(:upgrade_required)
      expect(JSON.parse(response.body)["message"]).to eq(SamplesController::CLI_DEPRECATION_MSG)
      expect(Sample.find_by(name: sample_name)).to be_nil
    end

    it "tags input files as cli uploads and returns the multipart response shape for an up-to-date CLI" do
      post "/samples/bulk_upload_with_metadata", params: { samples: [sample_params], metadata: metadata_params, client: "6.1.0", format: :json }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["errors"]).to eq([])

      # The CLI response shape replaces the default one: samples + errors, no sample_ids.
      expect(body.keys).to contain_exactly("samples", "errors")
      returned = body["samples"].first
      expect(returned["name"]).to eq(sample_name)
      expect(returned["input_files"].first.keys).to contain_exactly("multipart_upload_id", "s3_path", "source")

      created = Sample.find_by(name: sample_name)
      expect(created).to be_present
      # client != "web" -> every input file is stamped with the "cli" upload client.
      expect(created.input_files.map(&:upload_client)).to all(eq("cli"))
    end

    it "destroys a created sample that is missing a required metadata field" do
      # A required field must also be a default field (model validation), and
      # default_for_new_host_genome auto-associates it with host genomes.
      required_field = create(:metadata_field,
                              name: "branch3_required_field",
                              base_type: 0,
                              is_required: 1,
                              is_default: 1,
                              is_core: 1,
                              default_for_new_host_genome: 1)
      host_genome.reload
      host_genome.metadata_fields << required_field unless host_genome.metadata_fields.include?(required_field)
      project.metadata_fields << required_field unless project.metadata_fields.include?(required_field)

      # The destroy callback reaches out to S3; the branch under test is the destroy
      # itself, not the bucket cleanup.
      allow(S3Util).to receive(:delete_s3_prefix)
      allow(S3Util).to receive(:abort_multipart_uploads)

      post "/samples/bulk_upload_with_metadata", params: {
        samples: [sample_params],
        # No metadata at all -> the required field is missing after creation.
        metadata: {},
        client: "web",
        format: :json,
      }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["sample_ids"]).to eq([])
      expect(body["samples"]).to eq([])
      expect(body["errors"].to_s).to include("branch3_required_field")
      # Created, then removed again because of the missing required metadata.
      expect(Sample.find_by(name: sample_name)).to be_nil
    end
  end

  describe "GET /samples/:id.json" do
    before { sign_in @joe }

    it "reports the first pipeline run as the default pipeline run when one exists" do
      # Sample#default_background_id falls back to the Human host genome.
      create(:host_genome, name: "Human") unless HostGenome.find_by(name: "Human")
      sample = create(:sample, project: create(:project, users: [@joe]), user: @joe)
      pipeline_run = create(:pipeline_run, sample: sample)

      get "/samples/#{sample.id}.json"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["default_pipeline_run_id"]).to eq(pipeline_run.id)
      expect(body["editable"]).to be(true)
    end
  end

  describe "GET /samples/:id/report_v2" do
    before { sign_in @joe }

    it "keeps the client-supplied pipeline_version instead of backfilling it from the run" do
      sample = create(:sample, project: create(:project, users: [@joe]), user: @joe)
      create(:pipeline_run, sample: sample, pipeline_version: "3.10", job_status: PipelineRun::STATUS_CHECKED, finalized: 1)

      allow(PipelineReportService).to receive(:call).and_return('{"report":"branch3"}')

      get "/samples/#{sample.id}/report_v2.json", params: { pipeline_version: "3.10" }

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("branch3")
      expect(PipelineReportService).to have_received(:call)
    end
  end

  describe "POST /samples/benchmark (admin)" do
    it "collects workflow run ids for a non-mNGS benchmarked workflow" do
      create(:project, name: "Branch3 CZID Benchmarks", users: [@admin])
      benchmark_project = create(:project, name: "CZID Benchmarks", users: [@admin])
      source_sample = create(:sample, project: benchmark_project, user: @admin)
      workflow_run = create(:workflow_run, sample: source_sample, user: @admin,
                                           workflow: consensus_genome, deprecated: false)
      # A pipeline run exists too, so picking the workflow run proves the else arm ran.
      create(:pipeline_run, sample: source_sample, deprecated: false)

      sign_in @admin
      allow(AppConfigHelper).to receive(:get_workflow_version).and_return("1.0.0")
      allow_any_instance_of(WorkflowRun).to receive(:dispatch)

      post "/samples/benchmark", params: {
        sampleIds: [source_sample.id],
        workflowBenchmarked: consensus_genome,
      }

      expect(response).to have_http_status(:ok)
      benchmark_run = WorkflowRun.find(JSON.parse(response.body)["benchmarkWorkflowRunId"])
      expect(benchmark_run.workflow).to eq(WorkflowRun::WORKFLOW[:benchmark])
      expect(benchmark_run.inputs&.[]("run_ids")).to eq([workflow_run.id])
      expect(benchmark_run.inputs&.[]("workflow_benchmarked")).to eq(consensus_genome)
    end
  end
end

require 'rails_helper'

# Wave-2 coverage supplement for app/controllers/samples_controller.rb (ticket #585).
# Extends samples_controller_request_spec.rb + samples_controller_coverage2_request_spec.rb
# by driving the actions those specs never reach, hitting BOTH arms of each branch
# (auth/permission failures, empty-result arms, error rescues, format + workflow
# branches). No app code is changed here.
#
# Repo request-spec conventions:
#  - Warden rewrites 401 bodies -> assert status only.
#  - Unauthenticated HTML actions 302-redirect (not JSON 401).
RSpec.describe "Samples (coverage3) request", type: :request do
  create_users

  let(:illumina) { PipelineRun::TECHNOLOGY_INPUT[:illumina] }

  def project_for(user)
    create(:project, users: [user])
  end

  def sample_for(user, **attrs)
    create(:sample, project: project_for(user), user: user, **attrs)
  end

  describe "POST /samples/validate_sample_ids" do
    before { sign_in @joe }

    it "returns valid + invalid ids for an mNGS workflow (short_read_mngs technology arm)" do
      valid_sample = sample_for(@joe)
      create(:pipeline_run, sample: valid_sample, technology: illumina, finalized: 1, job_status: PipelineRun::STATUS_CHECKED)
      invalid_sample = sample_for(@joe) # no succeeded run

      allow(SampleAccessValidationService).to receive(:call)
        .and_return(viewable_samples: Sample.where(id: [valid_sample.id, invalid_sample.id]), error: nil)
      allow_any_instance_of(SamplesController).to receive(:get_succeeded_pipeline_runs_for_samples)
        .and_return(PipelineRun.where(sample_id: valid_sample.id))

      post "/samples/validate_sample_ids", params: { sampleIds: [valid_sample.id, invalid_sample.id], workflow: WorkflowRun::WORKFLOW[:short_read_mngs] }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["validIds"]).to include(valid_sample.id)
      expect(body["invalidSampleNames"]).to include(invalid_sample.name)
      expect(body["error"]).to be_nil
    end

    it "uses the WorkflowRun path for a non-mNGS workflow (else workflow arm)" do
      sample = sample_for(@joe)
      create(:workflow_run, sample: sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:consensus_genome])
      allow(SampleAccessValidationService).to receive(:call)
        .and_return(viewable_samples: Sample.where(id: sample.id), error: nil)

      post "/samples/validate_sample_ids", params: { sampleIds: [sample.id], workflow: WorkflowRun::WORKFLOW[:consensus_genome] }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to have_key("validIds")
    end

    it "returns the error payload when access validation reports an error (error arm)" do
      allow(SampleAccessValidationService).to receive(:call)
        .and_return(viewable_samples: Sample.none, error: "Some samples could not be validated")

      post "/samples/validate_sample_ids", params: { sampleIds: [1, 2] }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["validIds"]).to eq([])
      expect(body["error"]).to match(/could not be validated/)
    end
  end

  describe "POST /samples/validate_user_can_delete_objects" do
    before { sign_in @joe }

    it "looks up invalid sample names when there are invalid ids and no error (invalid-present arm)" do
      sample = sample_for(@joe)
      allow(DeletionValidationService).to receive(:call)
        .and_return(valid_ids: [], invalid_sample_ids: [sample.id], error: nil)

      post "/samples/validate_user_can_delete_objects", params: { selectedIds: [sample.id], workflow: WorkflowRun::WORKFLOW[:short_read_mngs] }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["invalidSampleNames"]).to include(sample.name)
      expect(body["error"]).to be_nil
    end

    it "returns the error and no name lookup when validation errors (error arm)" do
      allow(DeletionValidationService).to receive(:call)
        .and_return(valid_ids: [], invalid_sample_ids: [], error: "not allowed")

      post "/samples/validate_user_can_delete_objects", params: { selectedIds: [1], workflow: WorkflowRun::WORKFLOW[:amr] }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["error"]).to eq("not allowed")
      expect(body["invalidSampleNames"]).to eq([])
    end
  end

  describe "POST /samples/taxa_with_reads_suggestions" do
    before { sign_in @joe }

    it "returns 401 when a requested sample is not viewable (unauthorized arm)" do
      others = sample_for(@admin)
      expect(LogUtil).to receive(:log_error).at_least(:once)
      post "/samples/taxa_with_reads_suggestions", params: { sampleIds: [others.id], query: "kleb" }
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns taxa filtered to positive sample counts, using the taxLevel arm" do
      sample = sample_for(@joe)
      allow_any_instance_of(SamplesController).to receive(:taxon_search).and_return([{ "taxid" => 570 }])
      allow_any_instance_of(SamplesController).to receive(:add_sample_count_to_taxa_with_reads)
        .and_return([{ "taxid" => 570, "sample_count" => 2 }, { "taxid" => 571, "sample_count" => 0 }])

      post "/samples/taxa_with_reads_suggestions", params: { sampleIds: [sample.id], query: "kleb", taxLevel: "species" }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.map { |t| t["taxid"] }).to eq([570])
    end

    it "uses the default species+genus levels when no taxLevel is given (else arm)" do
      sample = sample_for(@joe)
      allow_any_instance_of(SamplesController).to receive(:add_sample_count_to_taxa_with_reads)
        .and_return([{ "taxid" => 573, "sample_count" => 1 }])
      expect_any_instance_of(SamplesController).to receive(:taxon_search).with("kleb", ["species", "genus"]).and_return([])

      post "/samples/taxa_with_reads_suggestions", params: { sampleIds: [sample.id], query: "kleb" }

      expect(response).to have_http_status(:ok)
    end
  end

  describe "POST /samples/taxa_with_contigs_suggestions" do
    before { sign_in @joe }

    it "returns 401 for an unviewable sample (unauthorized arm)" do
      others = sample_for(@admin)
      expect(LogUtil).to receive(:log_error).at_least(:once)
      post "/samples/taxa_with_contigs_suggestions", params: { sampleIds: [others.id], query: "kleb" }
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns taxa filtered to positive sample counts (happy arm)" do
      sample = sample_for(@joe)
      allow_any_instance_of(SamplesController).to receive(:taxon_search).and_return([{ "taxid" => 570 }])
      allow_any_instance_of(SamplesController).to receive(:add_sample_count_to_taxa_with_contigs)
        .and_return([{ "taxid" => 570, "sample_count" => 3 }, { "taxid" => 999, "sample_count" => 0 }])

      post "/samples/taxa_with_contigs_suggestions", params: { sampleIds: [sample.id], query: "kleb" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).map { |t| t["taxid"] }).to eq([570])
    end
  end

  describe "GET /samples/reads_stats" do
    before { sign_in @joe }

    it "returns the reads-stats payload for viewable samples (happy arm)" do
      sample = sample_for(@joe)
      allow(SampleAccessValidationService).to receive(:call)
        .and_return(viewable_samples: Sample.where(id: sample.id), error: nil)
      allow(ReadsStatsService).to receive(:call).and_return({ sample.id => { name: sample.name } })

      get "/samples/reads_stats.json", params: { sampleIds: [sample.id] }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to be_a(Hash)
    end

    it "rescues into a 500 when validation reports an error (rescue arm)" do
      allow(SampleAccessValidationService).to receive(:call)
        .and_return(viewable_samples: Sample.none, error: "bad")
      allow(LogUtil).to receive(:log_error)

      get "/samples/reads_stats.json", params: { sampleIds: [1] }

      expect(response).to have_http_status(:internal_server_error)
      expect(JSON.parse(response.body)["status"]).to match(/Internal server error/)
    end
  end

  describe "GET /samples/index_v2" do
    it "applies sorting_v0 ordering + basic mode for an allowed user (sorting_v0 + basic arms)" do
      @joe.add_allowed_feature("sorting_v0")
      sign_in @joe
      sample_for(@joe)

      get "/samples/index_v2.json", params: { domain: "my_data", basic: "true", orderBy: "createdAt", orderDir: "asc" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["samples"]).to be_an(Array)
    end

    it "returns full (non-basic) details with default id ordering (else arms)" do
      sign_in @joe
      sample = sample_for(@joe)

      get "/samples/index_v2.json", params: { domain: "my_data" }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["samples"].map { |s| s["id"] }).to include(sample.id)
    end
  end

  describe "GET /samples/dimensions (wide time span)" do
    before do
      sign_in @joe
      create(:metadata_field, name: "collection_location", base_type: MetadataField::LOCATION_TYPE)
      create(:metadata_field, name: "collection_location_v2", base_type: MetadataField::LOCATION_TYPE)
      create(:metadata_field, name: "sample_type", base_type: MetadataField::STRING_TYPE)
    end

    it "groups into MAX_BINS buckets when the sample span exceeds MAX_BINS days (else bins arm)" do
      project = create(:project, users: [@joe])
      create(:sample, project: project, user: @joe, created_at: 200.days.ago)
      create(:sample, project: project, user: @joe, created_at: 1.day.ago)

      get "/samples/dimensions.json", params: { domain: "my_data" }

      expect(response).to have_http_status(:ok)
      time_bins = JSON.parse(response.body).find { |d| d["dimension"] == "time_bins" }
      expect(time_bins["values"].length).to eq(SamplesController::MAX_BINS)
    end

    it "restricts to explicit sampleIds when provided (param_sample_ids arm)" do
      project = create(:project, users: [@joe])
      s1 = create(:sample, project: project, user: @joe)
      create(:sample, project: project, user: @joe)

      get "/samples/dimensions.json", params: { domain: "my_data", sampleIds: [s1.id] }

      expect(response).to have_http_status(:ok)
    end
  end

  describe "PUT /samples/:id (update, EDIT)" do
    before { sign_in @joe }

    it "renders the show json on a successful metadata update (success arm)" do
      sample = sample_for(@joe)
      create(:host_genome, name: "Human")

      put "/samples/#{sample.id}.json", params: { sample: { name: "Renamed Sample" } }

      expect(response).to have_http_status(:ok)
      expect(sample.reload.name).to eq("Renamed Sample")
    end

    it "returns bad_request when marking uploaded but a file is missing on S3 (s3 presence arm)" do
      sample = sample_for(@joe, status: Sample::STATUS_CREATED)
      allow_any_instance_of(InputFile).to receive(:s3_presence_check).and_return(false)

      put "/samples/#{sample.id}.json", params: { sample: { status: Sample::STATUS_UPLOADED } }

      expect(response).to have_http_status(:bad_request)
      expect(JSON.parse(response.body)["error"]).to match(/not yet available on S3/)
    end

    it "returns unprocessable_content when the update is invalid (failure arm)" do
      sample = sample_for(@joe)
      allow_any_instance_of(Sample).to receive(:update).and_return(false)

      put "/samples/#{sample.id}.json", params: { sample: { name: "" } }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PUT /samples/:id/kickoff_pipeline (admin, no runs)" do
    it "reports no run in progress (unprocessable json arm) when the sample has no runs" do
      sample = sample_for(@admin)
      sign_in @admin

      put "/samples/#{sample.id}/kickoff_pipeline.json"

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  describe "PUT /samples/:id/cancel_pipeline_run (admin)" do
    it "redirects with a 'no run in progress' notice when nothing is running (nil arm)" do
      sample = sample_for(@admin)
      sign_in @admin

      put "/samples/#{sample.id}/cancel_pipeline_run"

      expect(response).to have_http_status(:redirect)
    end

    it "cancels a running pipeline via SfnExecution (success arm)" do
      sample = sample_for(@admin)
      create(:pipeline_run, sample: sample, finalized: 0, deprecated: false)
      sign_in @admin
      sfn = instance_double(SfnExecution, stop_execution: true)
      allow(SfnExecution).to receive(:new).and_return(sfn)

      put "/samples/#{sample.id}/cancel_pipeline_run"

      expect(response).to have_http_status(:redirect)
    end

    it "reports failure when SfnExecution cannot stop (failure arm)" do
      sample = sample_for(@admin)
      create(:pipeline_run, sample: sample, finalized: 0, deprecated: false)
      sign_in @admin
      sfn = instance_double(SfnExecution, stop_execution: false)
      allow(SfnExecution).to receive(:new).and_return(sfn)

      put "/samples/#{sample.id}/cancel_pipeline_run"

      expect(response).to have_http_status(:redirect)
    end
  end

  describe "GET /samples/:id/pipeline_logs.json (admin, with a run)" do
    # FIXED (CZID-587): the json format now explicitly renders the logs. Prior to
    # the fix the action computed `get_pipeline_run_logs` without rendering, so
    # Rails fell through to default template lookup and raised
    # ActionController::UnknownFormat (500 in prod) for a sample that HAS a run.
    it "renders the pipeline run logs as json" do
      sample = sample_for(@admin)
      create(:pipeline_run, sample: sample)
      sign_in @admin
      allow_any_instance_of(PipelineRun).to receive(:get_pipeline_run_logs).and_return(["log line 1", "log line 2"])

      get "/samples/#{sample.id}/pipeline_logs.json"

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq(["log line 1", "log line 2"])
    end
  end

  describe "POST /samples/benchmark (admin)" do
    it "creates a benchmark sample + workflow run and dispatches it" do
      create(:project, name: "CZID Benchmarks")
      source_sample = sample_for(@admin)
      create(:pipeline_run, sample: source_sample, deprecated: false)
      sign_in @admin
      allow(AppConfigHelper).to receive(:get_workflow_version).and_return("1.0.0")
      allow_any_instance_of(WorkflowRun).to receive(:dispatch)

      post "/samples/benchmark", params: {
        sampleIds: [source_sample.id],
        workflowBenchmarked: WorkflowRun::WORKFLOW[:short_read_mngs],
      }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to have_key("benchmarkWorkflowRunId")
    end
  end

  describe "GET /samples/benchmark_ground_truth_files (admin)" do
    before { sign_in @admin }

    it "lists ground-truth files when the S3 listing succeeds (success arm)" do
      allow(Syscall).to receive(:pipe_with_output).and_return("truth1.csv\ntruth2.csv\n")

      get "/samples/benchmark_ground_truth_files"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["groundTruthFileNames"]).to contain_exactly("truth1.csv", "truth2.csv")
    end

    it "returns not_found when the S3 listing fails (failure arm)" do
      allow(Syscall).to receive(:pipe_with_output).and_return(nil)

      get "/samples/benchmark_ground_truth_files"

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["error"]).to match(/Failed to get ground truth files/)
    end
  end

  describe "GET /samples/:id/coverage_viz_data" do
    before { sign_in @joe }

    it "returns the fetched content when the path exists (happy arm)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:coverage_viz_data_s3_path).and_return("s3://b/data.json")
      allow(S3Util).to receive(:get_s3_file).and_return('{"ok":true}')

      get "/samples/#{sample.id}/coverage_viz_data.json", params: { accession_id: "ACC1" }

      expect(response).to have_http_status(:ok)
    end

    it "rescues an S3 error into a friendly error json (rescue arm)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:coverage_viz_data_s3_path).and_return("s3://b/data.json")
      allow(S3Util).to receive(:get_s3_file).and_raise(StandardError.new("s3 down"))

      get "/samples/#{sample.id}/coverage_viz_data.json", params: { accession_id: "ACC1" }

      expect(JSON.parse(response.body)["error"]).to match(/error fetching/i)
    end
  end

  describe "GET /samples/:id/report_csv" do
    before { sign_in @joe }

    it "sends the CSV report produced by PipelineReportService" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow(PipelineReportService).to receive(:call).and_return("a,b,c\n1,2,3\n")

      get "/samples/#{sample.id}/report_csv"

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("a,b,c")
    end
  end

  describe "GET /samples/:id/upload_credentials (owner, CREATED)" do
    it "returns the aws region merged with vended credentials (happy arm)" do
      sample = sample_for(@joe, status: Sample::STATUS_CREATED)
      sign_in @joe
      allow_any_instance_of(SamplesController).to receive(:get_upload_credentials)
        .and_return(credentials: { "AccessKeyId" => "AKIA", "SecretAccessKey" => "secret" })

      get "/samples/#{sample.id}/upload_credentials.json"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body).to have_key("aws_region")
      expect(body["AccessKeyId"]).to eq("AKIA")
    end
  end

  describe "GET /samples/:id/metadata (with a pipeline run)" do
    before { sign_in @joe }

    it "includes pipeline run display + summary stats when a run exists (pr-present arms)" do
      sample = sample_for(@joe)
      pr = create(:pipeline_run, sample: sample)
      allow_any_instance_of(SamplesController).to receive(:curate_pipeline_run_display).and_return({ id: pr.id })
      allow_any_instance_of(PipelineRun).to receive(:compare_ercc_counts).and_return([])
      allow_any_instance_of(SamplesController).to receive(:job_stats_get).and_return({ "x" => 1 })
      allow_any_instance_of(SamplesController).to receive(:get_summary_stats).and_return({ total: 1 })

      get "/samples/#{sample.id}/metadata.json"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["additional_info"]["pipeline_run"]).to be_present
      expect(body["additional_info"]["summary_stats"]).to be_present
    end
  end

  describe "POST /samples/:id/save_metadata_v2 (success arm)" do
    before { sign_in @joe }

    it "renders success when metadatum_add_or_update reports ok" do
      sample = sample_for(@joe)
      allow_any_instance_of(Sample).to receive(:metadatum_add_or_update).and_return({ status: "ok" })

      post "/samples/#{sample.id}/save_metadata_v2", params: { field: "sample_type", value: "CSF" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["status"]).to eq("success")
    end
  end

  describe "GET /samples/:id/show_taxid_fasta" do
    before { sign_in @joe }

    it "returns fasta via the combined NT_or_NR path (NT_or_NR arm)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(SamplesController).to receive(:get_taxon_fasta_from_pipeline_run_combined_nt_nr).and_return(">read\nACGT")
      allow_any_instance_of(SamplesController).to receive(:clean_taxid_name).and_return("kleb")

      get "/samples/#{sample.id}/fasta/1/570/NT_or_NR"

      expect(response).to have_http_status(:ok)
    end

    it "returns fasta via the single-hit-type path (else arm)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(SamplesController).to receive(:get_taxon_fasta_from_pipeline_run).and_return(">read\nACGT")
      allow_any_instance_of(SamplesController).to receive(:clean_taxid_name).and_return("kleb")

      get "/samples/#{sample.id}/fasta/1/570/NT"

      expect(response).to have_http_status(:ok)
    end
  end

  describe "GET /samples/:id/taxid_contigs_download (non-human)" do
    before { sign_in @joe }

    it "sends the concatenated contigs fasta for a non-human taxid" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      contig = build(:contig)
      allow_any_instance_of(PipelineRun).to receive(:get_contigs_for_taxid).and_return([contig])

      get "/samples/#{sample.id}/taxid_contigs_download", params: { taxid: 570 }

      expect(response).to have_http_status(:ok)
      expect(response.body).to include(contig.to_fa.strip[0, 3])
    end
  end

  describe "GET /samples/:id/taxid_contigs_for_blast" do
    before { sign_in @joe }

    it "returns up to the 3 longest contigs for a valid non-human NT taxid (happy arm)" do
      sample = sample_for(@joe)
      pr = create(:pipeline_run, sample: sample)
      create(:contig, pipeline_run: pr, species_taxid_nt: 570, genus_taxid_nt: 570, sequence: "ACGTACGTAC")

      get "/samples/#{sample.id}/taxid_contigs_for_blast.json", params: { taxid: 570, count_type: "NT" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to have_key("contigs")
    end

    it "returns no body for an unsupported count_type (count_type guard arm)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)

      get "/samples/#{sample.id}/taxid_contigs_for_blast.json", params: { taxid: 570, count_type: "xx" }

      expect(response.body).to be_blank
    end
  end

  describe "GET /samples/:id/taxon_five_longest_reads" do
    before { sign_in @joe }

    it "returns the five longest reads with alignment lengths (happy arm)" do
      sample = sample_for(@joe)
      pr = create(:pipeline_run, sample: sample)
      create(:taxon_byterange, taxid: 570, hit_type: "NT", first_byte: 0, last_byte: 100, pipeline_run_id: pr.id)
      allow_any_instance_of(PipelineRun).to receive(:s3_paths_for_taxon_byteranges).and_return({ 1 => { "NT" => "s3://b/reads" } })
      allow(S3Util).to receive(:get_s3_range).and_return(">r1\nACGTACGT\n>r2\nAC\n")

      get "/samples/#{sample.id}/taxon_five_longest_reads.json", params: { taxid: 570, tax_level: 1, count_type: "NT" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to have_key("reads")
    end

    it "renders a 500 error json when read fetching raises (rescue arm)" do
      sample = sample_for(@joe)
      pr = create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:s3_paths_for_taxon_byteranges).and_return({ 1 => { "NT" => "s3://b/reads" } })
      allow(S3Util).to receive(:get_s3_range).and_raise(StandardError.new("boom"))

      get "/samples/#{sample.id}/taxon_five_longest_reads.json", params: { taxid: 570, tax_level: 1, count_type: "NT" }

      expect(response).to have_http_status(:internal_server_error)
      expect(JSON.parse(response.body)["error"]).to match(/unexpected error/i)
    end
  end

  describe "byterange contig downloads" do
    before { sign_in @joe }

    it "concatenates byterange responses into a fasta (contigs_fasta_by_byteranges)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:contigs_fasta_s3_path).and_return("s3://b/contigs.fasta")
      allow_any_instance_of(SamplesController).to receive(:get_s3_file_byterange).and_return(">c1\nACGT\n")

      get "/samples/#{sample.id}/contigs_fasta_by_byteranges", params: { byteranges: ["0,10"] }

      expect(response).to have_http_status(:ok)
      expect(response.body).to include(">c1")
    end

    it "maps byterange responses into a sequences hash (contigs_sequences_by_byteranges)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:contigs_fasta_s3_path).and_return("s3://b/contigs.fasta")
      allow_any_instance_of(SamplesController).to receive(:get_s3_file_byterange).and_return(">c1\nACGT")

      get "/samples/#{sample.id}/contigs_sequences_by_byteranges", params: { byteranges: ["0,10"] }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to have_key(">c1")
    end
  end

  describe "GET /samples/:id/contigs_summary" do
    before { sign_in @joe }

    it "sends the generated contig mapping table csv" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      file = Tempfile.new(["contig_summary", ".csv"])
      file.write("contig,taxid\nc1,570\n")
      file.close
      allow_any_instance_of(PipelineRun).to receive(:generate_contig_mapping_table_file).and_return(file.path)

      get "/samples/#{sample.id}/contigs_summary"

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("contig,taxid")
    end
  end

  describe "GET /search_suggestions (elasticsearch path)" do
    before { sign_in @joe }

    it "returns no taxa (and does not search) for a project the user cannot view" do
      other = create(:user)
      private_project = create(:project, users: [other], name: "Someone else's project", public_access: 0)
      AppConfigHelper.set_app_config(AppConfig::BYPASS_ES_TAXON_SEARCH, "0")
      expect_any_instance_of(SamplesController).not_to receive(:taxon_search)

      get "/search_suggestions", params: { query: "Klebsiella", categories: ["taxon"], projectId: private_project.id }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).not_to have_key("Taxon")
    end

    it "caps sample suggestions at SEARCH_SUGGESTIONS_LIMIT" do
      project = create(:project, users: [@joe], name: "Many Samples")
      (SamplesController::SEARCH_SUGGESTIONS_LIMIT + 3).times { |i| create(:sample, project: project, user: @joe, name: "bulk sample #{i}") }

      get "/search_suggestions", params: { query: "bulk sample", domain: "my_data", categories: ["sample"] }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("Sample", "results").size).to eq(SamplesController::SEARCH_SUGGESTIONS_LIMIT)
    end

    it "runs the ES taxon search with superkingdom/project filters (non-bypass else arm)" do
      project = create(:project, users: [@joe], name: "ES Project")
      create(:sample, project: project, user: @joe, name: "ES Sample")
      AppConfigHelper.set_app_config(AppConfig::BYPASS_ES_TAXON_SEARCH, "0")
      allow_any_instance_of(SamplesController).to receive(:taxon_search).and_return([{ "title" => "Klebsiella", "taxid" => 570 }])

      get "/search_suggestions", params: { query: "Klebsiella", domain: "my_data", categories: ["taxon"], superkingdom: "Bacteria", projectId: project.id }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).dig("Taxon", "results")).to be_present
    end
  end
end

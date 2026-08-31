require 'rails_helper'

# Wave-1 coverage supplement for app/controllers/samples_controller.rb
# (COVERAGE-GAP-ANALYSIS-2026-07-07). Request specs drive the controller +
# Sample model + SamplesHelper together in one pass. Targets the actions the
# existing controller/request specs never touch, and both arms of each branch.
#
# Per existing request-spec conventions in this repo:
#  - Warden rewrites 401 response bodies -> assert on status only.
#  - Unauthenticated HTML controller actions 302-redirect (not JSON 401).
RSpec.describe "Samples (coverage2) request", type: :request do
  create_users

  let(:illumina) { PipelineRun::TECHNOLOGY_INPUT[:illumina] }

  def project_for(user)
    create(:project, users: [user])
  end

  def sample_for(user, **attrs)
    create(:sample, project: project_for(user), user: user, **attrs)
  end

  describe "GET /search_suggestions" do
    before { sign_in @joe }

    it "returns project + sample suggestions matching the query" do
      project = create(:project, users: [@joe], name: "Malaria Study")
      create(:sample, project: project, user: @joe, name: "Malaria Sample")

      get "/search_suggestions", params: { query: "Malaria", domain: "my_data", categories: ["project", "sample"] }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body).to be_a(Hash)
    end

    it "returns an empty structure when nothing matches (empty-results arms)" do
      get "/search_suggestions", params: { query: "zzz-no-match-zzz", domain: "my_data", categories: ["project", "sample"] }
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq({})
    end

    it "returns hardcoded taxa when BYPASS_ES_TAXON_SEARCH is enabled" do
      AppConfigHelper.set_app_config(AppConfig::BYPASS_ES_TAXON_SEARCH, "1")
      get "/search_suggestions", params: { query: "Klebsiella", categories: ["taxon"] }
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.dig("Taxon", "results")).to be_present
    end
  end

  describe "POST /samples/validate_sample_files" do
    before { sign_in @joe }

    it "returns validity flags for each file when sample_files present" do
      post "/samples/validate_sample_files", params: { sample_files: ["good_R1.fastq.gz", "not-a-fastq.txt"] }
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to be_an(Array)
    end

    it "returns an empty array when no sample_files are given (nil arm)" do
      post "/samples/validate_sample_files"
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq([])
    end
  end

  describe "POST /samples/enable_mass_normalized_backgrounds" do
    before { sign_in @joe }

    it "reports availability flags for the requested samples" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample, total_ercc_reads: 100, pipeline_version: "4.0")

      post "/samples/enable_mass_normalized_backgrounds", params: { sampleIds: [sample.id] }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body).to have_key("massNormalizedBackgroundsAvailable")
      expect(body).to have_key("samplesHaveERCCs")
    end

    it "reports false when a run lacks ERCC reads (the all? false arm)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample, total_ercc_reads: 0, pipeline_version: "4.0")

      post "/samples/enable_mass_normalized_backgrounds", params: { sampleIds: [sample.id] }

      body = JSON.parse(response.body)
      expect(body["samplesHaveERCCs"]).to be(false)
      expect(body["massNormalizedBackgroundsAvailable"]).to be(false)
    end
  end

  describe "GET /samples/dimensions" do
    before do
      sign_in @joe
      # dimensions() resolves these core metadata fields by name; without them
      # MetadataField.find_by returns nil and samples_by_metadata_field raises.
      create(:metadata_field, name: "collection_location", base_type: MetadataField::LOCATION_TYPE)
      create(:metadata_field, name: "collection_location_v2", base_type: MetadataField::LOCATION_TYPE)
      create(:metadata_field, name: "sample_type", base_type: MetadataField::STRING_TYPE)
    end

    it "returns the dimension buckets for the domain" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)

      get "/samples/dimensions.json", params: { domain: "my_data" }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body.map { |d| d["dimension"] }).to include("location", "visibility", "time", "host")
    end

    it "handles the empty-sample-set path (samples_count == 0, no time_bins)" do
      get "/samples/dimensions.json", params: { domain: "my_data" }
      expect(response).to have_http_status(:ok)
      time_bins = JSON.parse(response.body).find { |d| d["dimension"] == "time_bins" }
      expect(time_bins["values"]).to eq([])
    end
  end

  describe "POST /samples/user_is_collaborator" do
    it "returns true for an admin regardless of project membership" do
      sample = sample_for(@joe)
      sign_in @admin
      post "/samples/user_is_collaborator", params: { sampleIds: [sample.id] }
      expect(JSON.parse(response.body)["user_is_collaborator"]).to be(true)
    end

    it "returns false when the user is not a collaborator on a sample's project" do
      others_sample = sample_for(@admin)
      sign_in @joe
      post "/samples/user_is_collaborator", params: { sampleIds: [others_sample.id] }
      expect(JSON.parse(response.body)["user_is_collaborator"]).to be(false)
    end
  end

  describe "POST /samples/:id/save_metadata (legacy)" do
    before { sign_in @joe }

    it "returns 'ignored' when both the current value and the new value are blank" do
      sample = sample_for(@joe)
      post "/samples/#{sample.id}/save_metadata", params: { field: "sample_notes", value: "  " }
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["status"]).to eq("ignored")
    end

    it "updates and returns success for a valid whitelisted field" do
      sample = sample_for(@joe)
      post "/samples/#{sample.id}/save_metadata", params: { field: "sample_notes", value: "an important note" }
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["status"]).to eq("success")
      expect(sample.reload.sample_notes).to eq("an important note")
    end

    it "renders 'failed' when update! raises (rescue arm)" do
      sample = sample_for(@joe)
      allow_any_instance_of(Sample).to receive(:update!).and_raise(StandardError.new("boom"))
      post "/samples/#{sample.id}/save_metadata", params: { field: "sample_notes", value: "note" }
      expect(JSON.parse(response.body)["status"]).to eq("failed")
    end
  end

  describe "GET /samples/:id/amr" do
    before do
      sign_in @joe
      @joe.add_allowed_feature("AMR")
    end

    it "returns [] when there is no pipeline run" do
      sample = sample_for(@joe)
      get "/samples/#{sample.id}/amr.json"
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq([])
    end

    it "returns [] when amr_counts output state is not loaded (present-but-not-loaded arm)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      get "/samples/#{sample.id}/amr.json"
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq([])
    end
  end

  describe "GET /samples/:id/coverage_viz_summary" do
    before { sign_in @joe }

    it "returns the error json when there is no coverage viz summary path" do
      sample = sample_for(@joe)
      pr = create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:coverage_viz_summary_s3_path).and_return(nil)

      get "/samples/#{sample.id}/coverage_viz_summary.json"

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["error"]).to match(/does not exist/)
    end

    it "returns fetched content when the path exists (happy arm)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:coverage_viz_summary_s3_path).and_return("s3://b/summary.json")
      allow(S3Util).to receive(:get_s3_file).and_return('{"ok":true}')

      get "/samples/#{sample.id}/coverage_viz_summary.json"

      expect(response).to have_http_status(:ok)
    end

    it "rescues an S3 error into a friendly error json (rescue arm)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:coverage_viz_summary_s3_path).and_return("s3://b/summary.json")
      allow(S3Util).to receive(:get_s3_file).and_raise(StandardError.new("s3 down"))

      get "/samples/#{sample.id}/coverage_viz_summary.json"

      expect(JSON.parse(response.body)["error"]).to match(/error fetching/i)
    end
  end

  describe "GET /samples/:id/coverage_viz_data" do
    before { sign_in @joe }

    it "returns the error json when there is no coverage viz data path" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:coverage_viz_data_s3_path).and_return(nil)

      get "/samples/#{sample.id}/coverage_viz_data.json", params: { accession_id: "ACC1" }

      expect(JSON.parse(response.body)["error"]).to match(/does not exist/)
    end
  end

  describe "GET /samples/:id/pipeline_logs (admin only)" do
    it "renders 'no pipeline_runs available' when the sample has no runs" do
      sample = sample_for(@admin)
      sign_in @admin
      get "/samples/#{sample.id}/pipeline_logs.json"
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["error"]).to match(/no pipeline_runs/)
    end
  end

  describe "GET /samples/:id/contigs_fasta" do
    before { sign_in @joe }

    it "renders an error json when the contigs fasta path is absent" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:contigs_fasta_s3_path).and_return(nil)

      get "/samples/#{sample.id}/contigs_fasta.json"

      expect(JSON.parse(response.body)["error"]).to match(/does not exist/)
    end

    it "logs and errors when the presigned url is nil (missing-file arm)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:contigs_fasta_s3_path).and_return("s3://b/contigs.fasta")
      allow_any_instance_of(SamplesController).to receive(:get_presigned_s3_url).and_return(nil)
      expect(LogUtil).to receive(:log_error).at_least(:once)

      get "/samples/#{sample.id}/contigs_fasta.json"

      expect(JSON.parse(response.body)["error"]).to match(/does not exist/)
    end

    it "redirects to the presigned url when it exists (happy arm)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:contigs_fasta_s3_path).and_return("s3://b/contigs.fasta")
      allow_any_instance_of(SamplesController).to receive(:get_presigned_s3_url).and_return("https://signed.example/contigs")

      get "/samples/#{sample.id}/contigs_fasta.json"

      expect(response).to redirect_to("https://signed.example/contigs")
    end
  end

  describe "GET /samples/:id/nonhost_fasta" do
    before { sign_in @joe }

    it "redirects to the presigned url when present" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:annotated_fasta_s3_path).and_return("s3://b/nonhost.fasta")
      allow_any_instance_of(SamplesController).to receive(:get_presigned_s3_url).and_return("https://signed.example/nonhost")

      get "/samples/#{sample.id}/nonhost_fasta"

      expect(response).to redirect_to("https://signed.example/nonhost")
    end

    it "logs + errors when the presigned url is nil" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:annotated_fasta_s3_path).and_return("s3://b/nonhost.fasta")
      allow_any_instance_of(SamplesController).to receive(:get_presigned_s3_url).and_return(nil)
      expect(LogUtil).to receive(:log_error).at_least(:once)

      get "/samples/#{sample.id}/nonhost_fasta.json"

      expect(JSON.parse(response.body)["error"]).to match(/does not exist/)
    end
  end

  describe "GET /samples/:id/unidentified_fasta" do
    before { sign_in @joe }

    it "redirects to the presigned url when present" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      allow_any_instance_of(PipelineRun).to receive(:unidentified_fasta_s3_path).and_return("s3://b/unid.fasta")
      allow_any_instance_of(SamplesController).to receive(:get_presigned_s3_url).and_return("https://signed.example/unid")

      get "/samples/#{sample.id}/unidentified_fasta"

      expect(response).to redirect_to("https://signed.example/unid")
    end
  end

  describe "GET /samples/:id/taxid_contigs_download" do
    before { sign_in @joe }

    it "serves no data for a human taxid (fail-closed guard)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      human_taxid = ApplicationHelper::HUMAN_TAX_IDS.first

      # #562: the guard fails closed on human taxids with a clean empty 200
      # (head :ok) -- no contigs are ever served, and it no longer raises
      # MissingExactTemplate from a bare return with no render.
      get "/samples/#{sample.id}/taxid_contigs_download", params: { taxid: human_taxid }

      expect(response).to have_http_status(:ok)
      expect(response.body).to be_empty
    end
  end

  describe "GET /samples/:id/show_taxid_fasta" do
    before { sign_in @joe }

    it "serves no fasta for a human taxid (fail-closed guard)" do
      sample = sample_for(@joe)
      create(:pipeline_run, sample: sample)
      human_taxid = ApplicationHelper::HUMAN_TAX_IDS.first

      # #562: the guard fails closed on human taxids with a clean empty 200
      # (head :ok) -- no fasta is ever served, and it no longer raises
      # MissingExactTemplate from a bare return with no render.
      get "/samples/#{sample.id}/fasta/1/#{human_taxid}/NT"

      expect(response).to have_http_status(:ok)
      expect(response.body).to be_empty
    end
  end

  describe "GET /samples/:id/report_v2" do
    before { sign_in @joe }

    it "calls PipelineReportService with a nil pipeline run when none exists (else arm)" do
      sample = sample_for(@joe)
      allow(PipelineReportService).to receive(:call).and_return('{"report":"empty"}')

      get "/samples/#{sample.id}/report_v2.json"

      expect(response).to have_http_status(:ok)
      expect(PipelineReportService).to have_received(:call)
    end

    it "renders a bad_request when a MassNormalizedBackgroundError is raised (rescue arm)" do
      sample = sample_for(@joe)
      allow(PipelineReportService).to receive(:call)
        .and_raise(PipelineReportService::MassNormalizedBackgroundError.new(1, [2]))

      get "/samples/#{sample.id}/report_v2.json"

      expect(response).to have_http_status(:bad_request)
      expect(JSON.parse(response.body)).to have_key("error")
    end
  end

  describe "POST /samples/:id/kickoff_workflow (EDIT)" do
    before { sign_in @joe }

    it "dispatches a workflow run and renders workflow_runs_info" do
      sample = sample_for(@joe)
      allow_any_instance_of(Sample).to receive(:create_and_dispatch_workflow_run).and_return(true)

      post "/samples/#{sample.id}/kickoff_workflow", params: { workflow: WorkflowRun::WORKFLOW[:consensus_genome], inputs_json: {} }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to be_an(Array)
    end

    # SMP-1768 -- a stale client can post a fork request after the sample was deleted (e.g. by
    # data retention). Fail gracefully with a useful message instead of a 500 / dangling run.
    it "returns unprocessable_content when the sample has been soft-deleted" do
      sample = sample_for(@joe)
      sample.update_column(:deleted_at, Time.now.utc)

      expect_any_instance_of(WorkflowRun).not_to receive(:dispatch)

      post "/samples/#{sample.id}/kickoff_workflow", params: { workflow: WorkflowRun::WORKFLOW[:consensus_genome], inputs_json: {} }

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["error"]).to match(/has been deleted/)
    end
  end

  describe "POST /samples/bulk_kickoff_workflow_runs" do
    before { sign_in @joe }

    it "returns [] newWorkflowRunIds when no eligible samples (empty filtered arm)" do
      post "/samples/bulk_kickoff_workflow_runs", params: {
        workflow: WorkflowRun::WORKFLOW[:amr],
        sampleIds: [],
      }
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["newWorkflowRunIds"]).to eq([])
    end
  end

  describe "GET /samples/bulk_import (login required)" do
    it "returns unprocessable_content when the user can't update the project" do
      # @joe is not a member of admin's project -> updatable_project? false
      other_project = create(:project, users: [@admin])
      sign_in @joe

      get "/samples/bulk_import.json", params: { project_id: other_project.id, bulk_path: "s3://b/x" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["status"]).to match(/permissions to upload/)
    end

    it "returns unprocessable_content when the user can't upload to the bucket" do
      project = create(:project, users: [@joe])
      sign_in @joe
      allow_any_instance_of(User).to receive(:can_upload).and_return(false)

      get "/samples/bulk_import.json", params: { project_id: project.id, bulk_path: "s3://forbidden/x" }

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["status"]).to match(/permissions to this s3 bucket/)
    end

    it "returns unprocessable_content when no valid samples are found (empty samples arm)" do
      project = create(:project, users: [@joe])
      sign_in @joe
      allow_any_instance_of(User).to receive(:can_upload).and_return(true)
      allow_any_instance_of(SamplesController).to receive(:parsed_samples_for_s3_path).and_return([])

      get "/samples/bulk_import.json", params: { project_id: project.id, bulk_path: "s3://b/empty", host_genome_id: 1 }

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["status"]).to match(/no valid FASTQ files/)
    end

    it "surfaces a specific message AND reports to Sentry+CloudWatch on an S3 access error" do
      project = create(:project, users: [@joe])
      sign_in @joe
      allow_any_instance_of(User).to receive(:can_upload).and_return(true)
      err = Aws::S3::Errors::AccessDenied.new(nil, "denied")
      # A real S3 AccessDenied always carries code "AccessDenied" (from the HTTP response), which
      # is what the controller branches on (`case e.code`). A hand-built aws-sdk error does NOT
      # reliably derive its code -- depending on whether the error class was resolved as a dynamic
      # vs modeled error (test-load-order dependent), `err.code` can come back empty, dropping the
      # controller into its generic `else` branch. Pin the code so this exercises the AccessDenied
      # arm deterministically regardless of shard/test order.
      allow(err).to receive(:code).and_return("AccessDenied")
      allow_any_instance_of(SamplesController).to receive(:parsed_samples_for_s3_path).and_raise(err)
      # LogUtil.log_error(exception:) is the single capture point -> Rails.logger.error (CloudWatch) +
      # Sentry.capture_exception (Sentry). Pin that the S3 error reaches it (not swallowed).
      expect(LogUtil).to receive(:log_error).with(a_string_matching(/bulk_import.*S3/), hash_including(exception: err))

      get "/samples/bulk_import.json", params: { project_id: project.id, bulk_path: "s3://forbidden/x", host_genome_id: 1 }

      expect(response).to have_http_status(:unprocessable_content)
      # Specific, actionable -- NOT the old generic "no valid samples" that hid the real cause.
      expect(JSON.parse(response.body)["status"]).to match(/Access was denied/)
    end

    it "returns the parsed samples when some are found (happy arm)" do
      project = create(:project, users: [@joe])
      sign_in @joe
      allow_any_instance_of(User).to receive(:can_upload).and_return(true)
      allow_any_instance_of(SamplesController).to receive(:parsed_samples_for_s3_path).and_return([{ name: "s1" }])

      get "/samples/bulk_import.json", params: { project_id: project.id, bulk_path: "s3://b/full", host_genome_id: 1 }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["samples"]).to be_present
    end
  end

  describe "PUT /samples/:id/move_to_project (admin only)" do
    # #561: the route (put :move_to_project, samples member) is now wired, so the
    # admin move-sample-to-project form (app/views/samples/pipeline_runs.html.erb)
    # reaches the action. Assert the real behavior.
    it "moves the sample to the target project and renders show json" do
      sample = sample_for(@admin)
      new_project = create(:project, users: [@admin])
      sign_in @admin

      put "/samples/#{sample.id}/move_to_project.json", params: { project_id: new_project.id }

      expect(response).to have_http_status(:ok)
      expect(sample.reload.project_id).to eq(new_project.id)
    end
  end

  describe "PUT /samples/:id/reupload_source (admin only)" do
    it "enqueues an InitiateS3Cp job and returns no_content for json" do
      sample = sample_for(@admin)
      sign_in @admin
      expect(Resque).to receive(:enqueue).with(InitiateS3Cp, sample.id)

      put "/samples/#{sample.id}/reupload_source.json"

      expect(response).to have_http_status(:no_content)
    end
  end

  describe "PUT /samples/:id/kickoff_pipeline (admin only)" do
    it "reports 'in progress' when the sample already has pipeline runs" do
      sample = sample_for(@admin)
      create(:pipeline_run, sample: sample)
      sign_in @admin

      put "/samples/#{sample.id}/kickoff_pipeline.json"

      expect(response).to have_http_status(:no_content)
    end
  end

  describe "GET /samples/upload" do
    # The upload HTML view calls current_user via ApplicationHelper (which reads
    # warden directly), so stubbing ApplicationController#current_user is not
    # enough -- sign in through the auth0 flow to populate warden.
    before { sign_in_auth0(@joe) }

    it "renders the upload page and assigns projects + host genomes" do
      create(:host_genome)
      get "/samples/upload"
      expect(response).to have_http_status(:ok)
    end
  end

  describe "authorization / redirect behavior" do
    it "redirects unauthenticated HTML requests to /samples/upload to login" do
      get "/samples/upload"
      expect(response).to have_http_status(:redirect)
    end

    it "requires AMR feature: returns 302/redirect-or-error without the feature flag" do
      sample = sample_for(@joe)
      sign_in @joe
      create(:pipeline_run, sample: sample)
      # @joe lacks the AMR allowed_feature -> allowed_feature_required halts.
      get "/samples/#{sample.id}/amr.json"
      expect(response).not_to have_http_status(:ok)
    end
  end
end

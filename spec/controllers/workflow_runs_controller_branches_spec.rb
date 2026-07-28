require "rails_helper"

# Branch coverage for WorkflowRunsController: the download dispatch case/when arms
# (amr_report_downloads, benchmark_report_downloads, amr_gene_level_downloads,
# cg_report_downloads), the presigned-url present/absent forks, the SFN-description-missing
# rescues, the rerun 404 guard, index pagination ternaries, and the
# validate_workflow_run_ids error arm.
RSpec.describe WorkflowRunsController, type: :controller do
  create_users

  before do
    sign_in @joe
    @project = create(:project, users: [@joe])
    @sample = create(:sample, project: @project, user: @joe, name: "Joe Sample")
  end

  describe "GET #index pagination params" do
    it "honours an explicit offset and limit instead of the defaults" do
      create_list(:workflow_run, 3, sample: @sample, user: @joe,
                                    workflow: WorkflowRun::WORKFLOW[:consensus_genome])

      get :index, params: { domain: "my_data", offset: "1", limit: "1", format: "json" }

      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["workflow_runs"].length).to eq(1)
    end

    it "falls back to the default offset/limit when neither is supplied" do
      create_list(:workflow_run, 2, sample: @sample, user: @joe,
                                    workflow: WorkflowRun::WORKFLOW[:consensus_genome])

      get :index, params: { domain: "my_data", format: "json" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["workflow_runs"].length).to eq(2)
    end
  end

  describe "PUT #rerun for a workflow run the user cannot see" do
    it "stops after set_workflow_run rendered the 404 and never re-runs" do
      other_sample = create(:sample, project: create(:project), user: @admin)
      hidden_run = create(:workflow_run, sample: other_sample, user: @admin,
                                         workflow: WorkflowRun::WORKFLOW[:consensus_genome])
      expect_any_instance_of(WorkflowRun).not_to receive(:rerun)

      put :rerun, params: { id: hidden_run.id }

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["status"]).to eq("Workflow Run not found")
    end
  end

  describe "POST #validate_workflow_run_ids when the validation service reports an error" do
    it "returns empty lists and surfaces the error" do
      allow(WorkflowRunValidationService).to receive(:call).and_return(
        viewable_workflow_runs: WorkflowRun.none, error: "Some workflow runs are not viewable"
      )

      post :validate_workflow_run_ids, params: { workflowRunIds: [1, 2],
                                                 workflow: WorkflowRun::WORKFLOW[:consensus_genome], }

      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["validWorkflowRunIds"]).to eq([])
      expect(json["invalidSampleNames"]).to eq([])
      expect(json["error"]).to eq("Some workflow runs are not viewable")
    end
  end

  describe "GET #amr_report_downloads" do
    let(:amr_run) do
      create(:workflow_run, sample: @sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:amr])
    end

    before do
      allow_any_instance_of(AmrWorkflowRun).to receive(:output_path) { |_, key| "s3://bucket/#{key}" }
      allow_any_instance_of(described_class).to receive(:get_presigned_s3_url).and_return("https://s3/signed")
    end

    {
      "comprehensive_amr_metrics_tsv" => AmrWorkflowRun::OUTPUT_COMPREHENSIVE_AMR_METRICS_TSV,
      "non_host_reads" => AmrWorkflowRun::OUTPUT_NON_HOST_READS,
      "non_host_contigs" => AmrWorkflowRun::OUTPUT_NON_HOST_CONTIGS,
      "zip_link" => AmrWorkflowRun::OUTPUT_ZIP,
    }.each do |download_type, output_key|
      it "redirects to a presigned url for #{download_type}" do
        expect_any_instance_of(AmrWorkflowRun).to receive(:output_path).with(output_key)
                                                                       .and_return("s3://bucket/#{output_key}")

        get :amr_report_downloads, params: { id: amr_run.id, downloadType: download_type }

        expect(response).to have_http_status(:redirect)
        expect(response.headers["Location"]).to eq("https://s3/signed")
      end
    end

    it "sends the report CSV inline for report_csv" do
      allow(AmrReportDataService).to receive(:call).and_return("gene,contigs\nmecA,1\n")

      get :amr_report_downloads, params: { id: amr_run.id, downloadType: "report_csv" }

      expect(response).to have_http_status(:ok)
      expect(response.body).to eq("gene,contigs\nmecA,1\n")
      expect(response.headers["Content-Disposition"]).to include("_report.csv")
    end

    it "404s on an unrecognized download type" do
      get :amr_report_downloads, params: { id: amr_run.id, downloadType: "not_a_thing" }

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["status"]).to eq("Output not found")
    end

    it "404s when the presigned url cannot be generated" do
      allow_any_instance_of(described_class).to receive(:get_presigned_s3_url).and_return(nil)

      get :amr_report_downloads, params: { id: amr_run.id, downloadType: "zip_link" }

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["status"]).to eq("Output not available")
    end

    it "renders nothing extra when the output path is blank" do
      allow_any_instance_of(AmrWorkflowRun).to receive(:output_path).and_return(nil)

      get :amr_report_downloads, params: { id: amr_run.id, downloadType: "zip_link", format: :json }

      # Neither redirect nor error payload: the guarded block is skipped entirely.
      expect(response).to have_http_status(:no_content)
      expect(response.body).to be_empty
    end

    it "returns a graceful 404 when the SFN execution description is missing" do
      allow_any_instance_of(AmrWorkflowRun).to receive(:output_path)
        .and_raise(SfnExecution::SfnDescriptionNotFoundError.new("s3://fake/sfn-desc"))

      get :amr_report_downloads, params: { id: amr_run.id, downloadType: "zip_link" }

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["status"]).to eq("Output not available")
    end
  end

  describe "GET #benchmark_report_downloads" do
    let(:benchmark_run) do
      create(:workflow_run, sample: @sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:benchmark],
                            inputs_json: { workflow_benchmarked: "short-read-mngs" }.to_json)
    end

    before do
      allow_any_instance_of(BenchmarkWorkflowRun).to receive(:output_path).and_return("s3://bucket/benchmark.html")
      allow_any_instance_of(described_class).to receive(:get_presigned_s3_url).and_return("https://s3/signed-benchmark")
    end

    it "redirects to a presigned url for report_html" do
      get :benchmark_report_downloads, params: { id: benchmark_run.id, downloadType: "report_html" }

      expect(response).to have_http_status(:redirect)
      expect(response.headers["Location"]).to eq("https://s3/signed-benchmark")
    end

    it "404s on an unrecognized download type" do
      get :benchmark_report_downloads, params: { id: benchmark_run.id, downloadType: "nope" }

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["status"]).to eq("Output not found")
    end

    it "404s when the presigned url cannot be generated" do
      allow_any_instance_of(described_class).to receive(:get_presigned_s3_url).and_return(nil)

      get :benchmark_report_downloads, params: { id: benchmark_run.id, downloadType: "report_html" }

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["status"]).to eq("Output not available")
    end

    it "renders nothing extra when the output path is blank" do
      allow_any_instance_of(BenchmarkWorkflowRun).to receive(:output_path).and_return(nil)

      get :benchmark_report_downloads, params: { id: benchmark_run.id, downloadType: "report_html", format: :json }

      expect(response).to have_http_status(:no_content)
      expect(response.body).to be_empty
    end

    it "returns a graceful 404 when the SFN execution description is missing" do
      allow_any_instance_of(BenchmarkWorkflowRun).to receive(:output_path)
        .and_raise(SfnExecution::SfnDescriptionNotFoundError.new("s3://fake/sfn-desc"))

      get :benchmark_report_downloads, params: { id: benchmark_run.id, downloadType: "report_html" }

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["status"]).to eq("Output not available")
    end

    it "raises because the report_ipynb output constant does not exist" do
      # BenchmarkWorkflowRun::OUTPUT_BENCHMARK_NOTEBOOK is not defined anywhere in the app, so this
      # download type can only ever blow up. Documented here rather than papered over.
      expect do
        get :benchmark_report_downloads, params: { id: benchmark_run.id, downloadType: "report_ipynb" }
      end.to raise_error(NameError, /OUTPUT_BENCHMARK_NOTEBOOK/)
    end
  end

  describe "GET #amr_gene_level_downloads" do
    let(:amr_run) do
      create(:workflow_run, sample: @sample, user: @joe, workflow: WorkflowRun::WORKFLOW[:amr])
    end
    let(:fasta) do
  Tempfile.new(["gene", ".fasta"]).tap do |f|
  f.write(">g\nACGT\n")
  f.flush
end
end

    after { fasta.close! }

    it "sends the contigs fasta for download-contigs" do
      expect_any_instance_of(AmrWorkflowRun).to receive(:download_gene_level_contigs).with("ARO:123")
                                                                                     .and_return(fasta.path)

      get :amr_gene_level_downloads, params: { id: amr_run.id, downloadType: "download-contigs",
                                               indexId: "ARO:123", geneName: "mecA", }

      expect(response).to have_http_status(:ok)
      expect(response.headers["Content-Disposition"]).to include("amr-download-contigs-mecA.fasta")
    end

    it "sends the reads fasta for download-reads" do
      expect_any_instance_of(AmrWorkflowRun).to receive(:download_gene_level_reads).with("42")
                                                                                   .and_return(fasta.path)

      get :amr_gene_level_downloads, params: { id: amr_run.id, downloadType: "download-reads",
                                               indexId: "42", geneName: "mecA", }

      expect(response).to have_http_status(:ok)
      expect(response.headers["Content-Disposition"]).to include("amr-download-reads-mecA.fasta")
    end

    it "blows up on an unrecognized download type because it falls through to send_file(nil)" do
      # The else arm renders "Output not found" but then still calls send_file with an unassigned
      # `file`, so the request cannot complete. Documented, not worked around.
      expect do
        get :amr_gene_level_downloads, params: { id: amr_run.id, downloadType: "bogus",
                                                 indexId: "1", geneName: "mecA", }
      end.to raise_error(StandardError)
    end
  end

  describe "GET #cg_report_downloads" do
    it "returns a presigned url when the run has both a reference sequence and a ref_fasta input" do
      sample = create(:sample, project: @project, user: @joe, name: "CG Sample",
                               input_files: [build(:local_web_input_file),
                                             build(:local_web_reference_sequence_input_file),])
      run = create(:workflow_run, sample: sample, user: @joe,
                                  workflow: WorkflowRun::WORKFLOW[:consensus_genome],
                                  inputs_json: { ref_fasta: "file.fasta.gz" }.to_json)
      allow_any_instance_of(described_class).to receive(:get_presigned_s3_url).and_return("https://s3/ref-fasta")

      get :cg_report_downloads, params: { id: run.id, downloadType: "ref_fasta" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["url"]).to eq("https://s3/ref-fasta")
    end

    it "404s on an unrecognized download type" do
      run = create(:workflow_run, sample: @sample, user: @joe,
                                  workflow: WorkflowRun::WORKFLOW[:consensus_genome])

      get :cg_report_downloads, params: { id: run.id, downloadType: "something_else" }

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["status"]).to eq("File not found")
    end
  end
end

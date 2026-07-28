require "rails_helper"

# Branch coverage for the consensus-genome clade export arms of WorkflowRunsController:
# the "a reference tree was supplied" fork around the second S3 upload, and the
# `workflow_runs&.pluck(:sample_id)&.uniq` analytics attribution on the export.
# S3 and presigning are stubbed -- this is about which arm runs and what gets attributed.
RSpec.describe WorkflowRunsController, type: :controller do
  create_users

  let(:sars_cov_2_inputs_json) do
    { "accession_id" => ConsensusGenomeWorkflowRun::SARS_COV_2_ACCESSION_ID,
      "technology" => "Illumina",
      "wetlab_protocol" => "artic", }.to_json
  end

  before do
    sign_in @joe
    @project = create(:project, users: [@joe])
    @sample_one = create(:sample, project: @project, user: @joe, name: "Clade Sample One")
    @sample_two = create(:sample, project: @project, user: @joe, name: "Clade Sample Two")

    @run_one = create(:workflow_run, sample: @sample_one, user: @joe,
                                     workflow: WorkflowRun::WORKFLOW[:consensus_genome],
                                     status: WorkflowRun::STATUS[:succeeded],
                                     inputs_json: sars_cov_2_inputs_json)
    @run_two = create(:workflow_run, sample: @sample_two, user: @joe,
                                     workflow: WorkflowRun::WORKFLOW[:consensus_genome],
                                     status: WorkflowRun::STATUS[:succeeded],
                                     inputs_json: sars_cov_2_inputs_json)

    allow(ConsensusGenomeConcatService).to receive(:call).and_return(">s1\nACGT\n")
    allow(S3Util).to receive(:upload_to_s3)
    allow(controller).to receive(:get_presigned_s3_url) do |args|
      "https://s3.example.test/#{args[:key]}?signed=1"
    end
  end

  describe "POST #consensus_genome_clade_export without a reference tree" do
    it "uploads only the fasta and builds a Nextclade link with no input-tree" do
      expect(S3Util).to receive(:upload_to_s3).once

      post :consensus_genome_clade_export, params: { workflowRunIds: [@run_one.id, @run_two.id] }

      expect(response).to have_http_status(:ok)
      external_url = JSON.parse(response.body)["external_url"]
      expect(external_url).to start_with("https://clades.nextstrain.org")
      expect(external_url).to include("input-fasta")
      expect(external_url).not_to include("input-tree")
    end

    it "attributes the export to the deduplicated sample ids of the exported runs" do
      captured = nil
      allow(MetricUtil).to receive(:log_analytics_event) do |_event, _user, payload, _request|
        captured = payload
      end

      post :consensus_genome_clade_export, params: { workflowRunIds: [@run_one.id, @run_two.id] }

      expect(response).to have_http_status(:ok)
      expect(captured[:sample_ids]).to contain_exactly(@sample_one.id, @sample_two.id)
      expect(captured[:workflow_run_ids]).to contain_exactly(@run_one.id, @run_two.id)
    end
  end

  describe "POST #consensus_genome_clade_export with a reference tree" do
    it "uploads the tree as well and adds input-tree to the Nextclade link" do
      expect(S3Util).to receive(:upload_to_s3).twice

      post :consensus_genome_clade_export, params: { workflowRunIds: [@run_one.id],
                                                     referenceTree: "{\"tree\": true}", }

      expect(response).to have_http_status(:ok)
      external_url = JSON.parse(response.body)["external_url"]
      expect(external_url).to include("input-tree")
      expect(external_url).to include("input-fasta")
      # JSON.generate is used explicitly so the ampersand is not unicode-escaped.
      expect(response.body).not_to include("\\u0026")
    end

    it "uploads the tree contents that the caller supplied to the clade-tree key" do
      captured_bodies = []
      allow(S3Util).to receive(:upload_to_s3) do |_bucket, key, content|
        captured_bodies << [key, content]
      end

      post :consensus_genome_clade_export, params: { workflowRunIds: [@run_one.id],
                                                     referenceTree: "my-tree-payload", }

      expect(response).to have_http_status(:ok)
      tree_upload = captured_bodies.find { |key, _content| key.start_with?("clade_exports/trees/") }
      expect(tree_upload).not_to be_nil
      expect(tree_upload.last).to eq("my-tree-payload")
    end
  end
end

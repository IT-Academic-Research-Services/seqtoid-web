# frozen_string_literal: true

require "rails_helper"

# Coverage Wave (branch): residual branch sweep for PhyloTreeNgsController,
# complementing phylo_tree_ngs_controller_spec.rb (create happy/unauthorized paths)
# and phylo_tree_ngs_controller_branches_spec.rb (guards, new_pr_ids/new_pr_info
# switches, coverage-viz helpers). Still untaken before this file:
#
#   - create: the rescue arm around save!/dispatch
#   - new_pr_ids: the `projectId&.to_i` nil-receiver arm
#   - sample_details_json: the `if metadata_by_sample_id[...]` then-arm, i.e. a
#     sample that actually carries metadata (existing specs only use bare samples)
RSpec.describe PhyloTreeNgsController, type: :controller do
  create_users

  let(:project) { create(:project, users: [@joe]) }
  let(:sample) { create(:sample, project: project, name: "Sample A") }
  let!(:pipeline_run) { create(:pipeline_run, sample: sample, job_status: "CHECKED") }

  # TaxonLineage#tax_level is derived from the first positive <level>_taxid, so a
  # positive species_taxid is what makes this a species-level lineage.
  let!(:species_lineage) do
    create(:taxon_lineage,
           taxid: 573,
           genus_taxid: 570,
           species_taxid: 573,
           superkingdom_name: "Bacteria")
  end

  before { sign_in @joe }

  describe "POST create when saving fails" do
    it "logs the failure and answers not_acceptable (the rescue arm)" do
      allow(controller).to receive(:get_additional_reference_accession_ids).and_return([])
      allow_any_instance_of(PhyloTreeNg).to receive(:save!).and_raise(StandardError, "kaboom")
      expect(LogUtil).to receive(:log_error).with(/PhyloTreeNgFailedEvent/, hash_including(:exception))

      post :create, params: {
        taxId: 573,
        projectId: project.id,
        pipelineRunIds: [pipeline_run.id],
        name: "Doomed Tree",
      }, format: :json

      expect(JSON.parse(response.body)["status"]).to eq("not_acceptable")
      expect(PhyloTreeNg.count).to eq(0)
    end
  end

  describe "GET new_pr_ids without a projectId" do
    it "treats the missing projectId as nil and returns empty lists (the &. nil arm)" do
      get :new_pr_ids, params: { getAdditionalSamples: "false", taxId: 573 }, format: :json

      expect(response).to have_http_status(:success)
      body = JSON.parse(response.body)
      expect(body["pipelineRunIds"]).to eq([])
      expect(body["runsWithContigs"]).to eq([])
    end
  end

  describe "#sample_details_json metadata merge" do
    before do
      allow(controller).to receive(:current_power).and_return(Power.new(@joe))
    end

    it "copies the sample metadata onto the row when it exists (the then-arm)" do
      described_sample = create(:sample, project: project, name: "Sample With Metadata",
                                         metadata_fields: { sample_type: "Serum" })
      run = create(:pipeline_run, sample: described_sample, job_status: "CHECKED")

      details = controller.send(:sample_details_json, [run.id], 573, contigs_only: false)

      expect(details.length).to eq(1)
      expect(details.first["tissue"]).to eq("Serum")
      expect(details.first).to have_key("location")
    end

    it "leaves the metadata keys off a sample with no metadata (the else-arm)" do
      details = controller.send(:sample_details_json, [pipeline_run.id], 573, contigs_only: false)

      expect(details.length).to eq(1)
      expect(details.first).not_to have_key("tissue")
    end
  end
end

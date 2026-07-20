require 'rails_helper'

# Branch-coverage spec for PhyloTreesController.
#
# The existing controller spec covers only validate_name, and the request spec covers
# the index JSON shape, the human-taxid guard, choose_taxon (args only), the scoped
# show lookup, and the download not-found arm. This fills the remaining arms:
#   * index: the `if project_id` and `if taxid` restriction arms
#   * choose_taxon: the `if params[:projectId]` and `if params[:sampleId]` filter arms
#   * download: the success arm (s3_file present AND download succeeds -> send_file)
#
# TEST-ONLY. Mutation-checked.
RSpec.describe PhyloTreesController, type: :controller do
  create_users

  before { sign_in @joe }

  describe "GET #index restriction arms" do
    it "restricts to the given project and taxid, resolving the taxon name" do
      project = create(:project, users: [@joe])
      create(:taxon_lineage, taxid: 570, tax_name: "Klebsiella")
      in_scope = create(:phylo_tree, user: @joe, project: project, taxid: 570, name: "In scope")
      # A tree on the same project but a different taxid must be filtered out by the
      # taxid arm; a tree on a different project by the project arm.
      other_taxid = create(:phylo_tree, user: @joe, project: project, taxid: 999, name: "Other taxid")
      other_project = create(:project, users: [@joe])
      other_proj_tree = create(:phylo_tree, user: @joe, project: other_project, taxid: 570, name: "Other project")

      get :index, params: { format: "json", projectId: project.id, taxId: 570 }

      expect(response).to have_http_status(:success)
      ids = JSON.parse(response.body)["phyloTrees"].map { |t| t["id"] }
      expect(ids).to include(in_scope.id)
      expect(ids).not_to include(other_taxid.id)
      expect(ids).not_to include(other_proj_tree.id)
    end
  end

  describe "GET #choose_taxon filter arms" do
    it "adds a project_id filter (and no samples filter) when projectId is given" do
      project = create(:project, users: [@joe])
      captured = nil
      allow_any_instance_of(PhyloTreesController).to receive(:taxon_search) do |_ctrl, _q, _lv, filters|
        captured = filters
        []
      end

      get :choose_taxon, params: { query: "kleb", projectId: project.id }

      expect(response).to have_http_status(:success)
      expect(captured[:project_id]).to eq(project.id)
      expect(captured).not_to have_key(:samples)
    end

    it "adds a samples filter (and no project filter) when sampleId is given" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project)
      captured = nil
      allow_any_instance_of(PhyloTreesController).to receive(:taxon_search) do |_ctrl, _q, _lv, filters|
        captured = filters
        []
      end

      get :choose_taxon, params: { query: "kleb", sampleId: sample.id }

      expect(response).to have_http_status(:success)
      expect(captured[:samples]).to be_present
      expect(captured).not_to have_key(:project_id)
    end
  end

  describe "GET #download success arm" do
    it "streams the file when the output exists and the S3 download succeeds" do
      tree = create(:phylo_tree, user: @joe, name: "My Tree", newick: "s3://bucket/tree.newick")
      # The success arm requires both the column value AND a successful S3 fetch;
      # stub the fetch true so the controller reaches send_file instead of head 404.
      allow_any_instance_of(PhyloTreesController).to receive(:download_to_filename?).and_return(true)

      get :download, params: { id: tree.id, output: "newick" }

      expect(response).to have_http_status(:success)
      expect(response.headers["Content-Disposition"]).to include("attachment")
    end
  end
end

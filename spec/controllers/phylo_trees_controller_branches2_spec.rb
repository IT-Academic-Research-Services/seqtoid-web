require 'rails_helper'

# Second branch-coverage spec for PhyloTreesController, companion to
# phylo_trees_controller_branches_spec.rb (index/choose_taxon/download) and the
# request spec. The arms still untaken live in #show and in the private
# #sample_details_json helper:
#
#   * show: `@phylo_tree.user&.name` (user present AND missing), the
#     `if @phylo_tree.tax_level == 1` parent-taxid arm (both ways) and the
#     `if current_user.admin?` log_url arm (both ways).
#   * sample_details_json: the two early-return guards (blank pipeline_run_ids,
#     human taxid) and the per-row `if metadata_by_sample_id[...]` arm both ways.
#
# TEST-ONLY. No app code touched.
RSpec.describe PhyloTreesController, type: :controller do
  create_users

  def show_json(tree, format: "json")
    get :show, params: { id: tree.id, format: format }
    JSON.parse(response.body)
  end

  describe "GET #show" do
    before { sign_in @joe }

    it "includes the tree owner's name and omits log_url for a non-admin" do
      tree = create(
        :phylo_tree,
        user: @joe,
        name: "Joe Show Tree",
        taxid: 570,
        tax_level: TaxonCount::TAX_LEVEL_GENUS,
        newick: "(a,b);"
      )

      body = show_json(tree)

      expect(response).to have_http_status(:success)
      expect(body["user"]).to eq(@joe.name)
      # tax_level is genus (2), so the species-only parent_taxid lookup is skipped.
      expect(body).not_to have_key("parent_taxid")
      # Non-admin: the log_url arm is not taken.
      expect(body).not_to have_key("log_url")
      expect(body["sampleDetailsByNodeName"]).to eq({})
    end

    it "resolves parent_taxid from the lineage when the tree is at species level" do
      create(:taxon_lineage, taxid: 571, genus_taxid: 570)
      tree = create(
        :phylo_tree,
        user: @joe,
        name: "Species Level Tree",
        taxid: 571,
        tax_level: TaxonCount::TAX_LEVEL_SPECIES
      )

      body = show_json(tree)

      expect(body["parent_taxid"]).to eq(570)
    end

    it "leaves the user blank when the tree has no associated user" do
      tree = create(:phylo_tree, user: @joe, name: "Orphan Tree", tax_level: TaxonCount::TAX_LEVEL_GENUS)
      # Simulate the missing-user case the `&.` guards against (seen in local dev
      # and in trees whose owner row is gone).
      allow_any_instance_of(PhyloTree).to receive(:user).and_return(nil)

      body = show_json(tree)

      expect(body["user"]).to be_nil
      expect(response).to have_http_status(:success)
    end

    it "merges the NCBI metadata nodes, defaulting a node name to its accession" do
      tree = create(:phylo_tree, user: @joe, name: "NCBI Tree", tax_level: TaxonCount::TAX_LEVEL_GENUS)
      tree.update_column( # rubocop:disable Rails/SkipsModelValidations
        :ncbi_metadata,
        { "NODE_1" => { "accession" => "NC_000001" }, "NODE_2" => { "accession" => "NC_000002", "name" => "Named" } }.to_json
      )

      nodes = show_json(tree)["sampleDetailsByNodeName"]

      expect(nodes["NODE_1"]["name"]).to eq("NC_000001")
      expect(nodes["NODE_2"]["name"]).to eq("Named")
    end
  end

  describe "GET #show as an admin" do
    before { sign_in @admin }

    it "exposes log_url on the tree JSON" do
      tree = create(:phylo_tree, user: @admin, name: "Admin Tree", tax_level: TaxonCount::TAX_LEVEL_GENUS)
      allow_any_instance_of(PhyloTree).to receive(:log_url).and_return("https://logs.example/phylo")

      body = show_json(tree)

      expect(body["log_url"]).to eq("https://logs.example/phylo")
    end
  end

  describe "#sample_details_json" do
    before { sign_in @joe }

    it "returns an empty list when there are no pipeline run ids" do
      expect(controller.send(:sample_details_json, [], 570)).to eq([])
      expect(controller.send(:sample_details_json, nil, 570)).to eq([])
    end

    it "returns an empty list for a human taxid (never expose human reads)" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project)
      pr = create(:pipeline_run, sample: sample)

      human_taxid = ApplicationHelper::HUMAN_TAX_IDS.first
      expect(controller.send(:sample_details_json, [pr.id], human_taxid)).to eq([])
    end

    it "returns one row per pipeline run, attaching metadata only where it exists" do
      project = create(:project, users: [@joe], name: "Branch Project")
      with_meta = create(:sample, project: project, name: "With Metadata", metadata_fields: { collection_location_v2: "Redwood City, USA", sample_type: "Serum" })
      without_meta = create(:sample, project: project, name: "No Metadata")
      pr_with = create(:pipeline_run, sample: with_meta)
      pr_without = create(:pipeline_run, sample: without_meta)

      rows = controller.send(:sample_details_json, [pr_with.id, pr_without.id], 570)

      expect(rows.length).to eq(2)
      by_name = rows.index_by { |r| r["name"] }
      expect(by_name["With Metadata"]["tissue"]).to eq("Serum")
      expect(by_name["With Metadata"]["location"]).to eq("Redwood City, USA")
      # The else arm: no metadata row for this sample, so no keys are added.
      expect(by_name["No Metadata"]).not_to have_key("tissue")
      expect(by_name["No Metadata"]).not_to have_key("location")
      expect(by_name["No Metadata"]["project_name"]).to eq("Branch Project")
    end
  end
end

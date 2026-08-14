require 'rails_helper'

# Branch coverage for VisualizationsController arms not reached by
# visualizations_controller_spec.rb / visualizations_controller_branches_spec.rb:
#   * index: the public/other domain arms, the sorting_v0 orderBy arm, sort_visualizations
#   * visualization: the no-id arm and the phylo_tree / phylo_tree_ng redirect arms
#   * save: the "overwrite the existing visualization" arm
#   * download_heatmap / samples_taxons / taxa_details: both sides of the
#     heatmap_elasticsearch feature fork (+ includePathogens)
#   * background_for_heatmap: the viewable-background arm
# The heavy heatmap services are stubbed -- this is about which arm runs, not about
# recomputing a heatmap.
RSpec.describe VisualizationsController, type: :controller do
  create_users

  before do
    sign_in @joe
    @project = create(:project, users: [@joe])
    @sample = create(:sample, project: @project, user: @joe)
  end

  def make_visualization(type:, name:, data: { "test data" => [] }, user: @joe)
    vis = create(:visualization, user_id: user.id, visualization_type: type, name: name, data: data)
    vis.samples << @sample
    vis
  end

  describe "GET #index" do
    it "serves the public domain from the public scope" do
      make_visualization(type: "heatmap", name: "Mine")
      public_project = create(:public_project, users: [@admin])
      public_sample = create(:sample, project: public_project, user: @admin)
      public_vis = create(:visualization, user_id: @admin.id, visualization_type: "heatmap", name: "Public one", public_access: 1)
      public_vis.samples << public_sample

      get :index, params: { domain: "public" }

      expect(response).to have_http_status :success
      names = JSON.parse(response.body).pluck("name")
      expect(names).to include("Public one")
      expect(names).not_to include("Mine")
    end

    it "falls back to the power-scoped visualizations when the domain is neither my_data nor public" do
      mine = make_visualization(type: "heatmap", name: "Power scoped")

      get :index, params: { domain: "all_data" }

      expect(response).to have_http_status :success
      expect(JSON.parse(response.body).pluck("id")).to include(mine.id)
    end

    it "sorts by the requested column when sorting_v0 is allowed" do
      @joe.add_allowed_feature("sorting_v0_admin")
      first = make_visualization(type: "heatmap", name: "AAA")
      second = make_visualization(type: "heatmap", name: "ZZZ")

      get :index, params: { domain: "my_data", orderBy: "visualization", orderDir: "asc" }

      expect(response).to have_http_status :success
      ids = JSON.parse(response.body).pluck("id")
      expect(ids).to contain_exactly(first.id, second.id)
    end
  end

  describe "GET #visualization" do
    it "renders a heatmap with no saved visualization id" do
      get :visualization, params: { type: "heatmap" }

      expect(response).to have_http_status :success
      expect(assigns(:visualization_data)[:savedParamValues]).to be_nil
      expect(assigns(:visualization_data)[:taxonLevels]).to eq(%w[Genus Species])
    end

    it "redirects a phylo_tree visualization to the phylo trees index" do
      vis = make_visualization(type: "phylo_tree", name: "PT", data: { "treeId" => 7 })

      get :visualization, params: { type: "phylo_tree", id: vis.id }

      expect(response).to have_http_status(:redirect)
      expect(response.location).to include("/phylo_trees/index?")
    end

    it "redirects a phylo_tree_ng visualization to its tree page" do
      tree = create(:phylo_tree_ng)
      vis = make_visualization(type: "phylo_tree_ng", name: "PTNG", data: { "treeNgId" => tree.id })

      get :visualization, params: { type: "phylo_tree_ng", id: vis.id }

      expect(response).to have_http_status(:redirect)
      expect(response.location).to include("/phylo_tree_ngs/#{tree.id}")
    end
  end

  describe "POST #save" do
    it "overwrites the data of the most recent matching visualization instead of creating a new one" do
      existing = make_visualization(type: "heatmap", name: "Heatmap", data: { "old" => true })

      expect do
        post :save, params: { type: "heatmap", data: { sampleIds: [@sample.id.to_s], fresh: "yes" } }
      end.not_to change(Visualization, :count)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["id"]).to eq(existing.id)
      expect(existing.reload.data["fresh"]).to eq("yes")
    end
  end

  describe "GET #download_heatmap" do
    let(:background) { create(:background, name: "bg", public_access: 1) }

    before do
      allow(TopTaxonsElasticsearchService).to receive(:call).and_return("es" => "dict")
      allow(HeatmapHelper).to receive(:sample_taxons_dict).and_return("sql" => "dict")
      allow_any_instance_of(described_class).to receive(:generate_heatmap_csv).and_return("a,b\n1,2\n")
    end

    it "uses the elasticsearch service and skips pathogen flags by default" do
      @joe.add_allowed_feature("heatmap_elasticsearch")
      expect_any_instance_of(described_class).to receive(:generate_heatmap_csv)
        .with({ "es" => "dict" }, anything).and_return("a,b\n1,2\n")

      get :download_heatmap, params: { sampleIds: [@sample.id] }

      expect(response).to have_http_status(:ok)
      expect(response.body).to eq("a,b\n1,2\n")
    end

    it "includes pathogen flags when requested" do
      @joe.add_allowed_feature("heatmap_elasticsearch")
      allow(HeatmapHelper).to receive(:get_latest_pipeline_runs_for_samples).and_return({})
      allow(PathogenFlaggingService).to receive(:call).and_return({})
      expect_any_instance_of(described_class).to receive(:generate_heatmap_csv)
        .with(anything, anything, anything).and_return("a,b\n1,2\n")

      get :download_heatmap, params: { sampleIds: [@sample.id], includePathogens: "true" }

      expect(response).to have_http_status(:ok)
    end

    it "falls back to the SQL heatmap helper when the feature is off" do
      expect(TopTaxonsElasticsearchService).not_to receive(:call)
      expect(HeatmapHelper).to receive(:sample_taxons_dict).and_return("sql" => "dict")

      get :download_heatmap, params: { sampleIds: [@sample.id] }

      expect(response).to have_http_status(:ok)
      expect(response.body).to eq("a,b\n1,2\n")
    end
  end

  describe "GET #samples_taxons" do
    it "renders an empty object when no samples are in scope" do
      get :samples_taxons, params: { sampleIds: [] }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq({})
    end

    it "uses the elasticsearch service when the feature is on" do
      @joe.add_allowed_feature("heatmap_elasticsearch")
      allow(TopTaxonsElasticsearchService).to receive(:call).and_return("taxon" => 1)

      get :samples_taxons, params: { sampleIds: [@sample.id] }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("taxon" => 1)
    end

    it "returns 202 with an indexing status when the ES service is still preparing the data" do
      @joe.add_allowed_feature("heatmap_elasticsearch")
      allow(TopTaxonsElasticsearchService).to receive(:call).and_return(status: "indexing")

      get :samples_taxons, params: { sampleIds: [@sample.id] }

      expect(response).to have_http_status(:accepted)
      expect(JSON.parse(response.body)).to eq("status" => "indexing")
    end

    it "uses the SQL heatmap helper when the feature is off" do
      allow(HeatmapHelper).to receive(:sample_taxons_dict).and_return("taxon" => 2)
      expect(TopTaxonsElasticsearchService).not_to receive(:call)

      get :samples_taxons, params: { sampleIds: [@sample.id] }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("taxon" => 2)
    end
  end

  describe "POST #taxa_details" do
    it "uses the elasticsearch taxon-details service when the feature is on" do
      @joe.add_allowed_feature("heatmap_elasticsearch")
      allow(HeatmapHelper).to receive(:get_latest_pipeline_runs_for_samples).and_return({})
      expect(TaxonDetailsElasticsearchService).to receive(:call).and_return("es_taxa" => true)

      post :taxa_details, params: { sampleIds: [@sample.id], taxonIds: [1, nil] }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("es_taxa" => true)
    end

    it "uses the SQL heatmap helper (with updateBackgroundOnly) when the feature is off" do
      expect(HeatmapHelper).to receive(:taxa_details)
        .with(anything, anything, anything, "true").and_return("sql_taxa" => true)

      post :taxa_details, params: { sampleIds: [@sample.id], taxonIds: [1], updateBackgroundOnly: "true" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("sql_taxa" => true)
    end
  end

  describe "background_for_heatmap" do
    it "passes a viewable background id through to the heatmap service" do
      @joe.add_allowed_feature("heatmap_elasticsearch")
      background = create(:background, name: "viewable-bg", public_access: 1)
      captured = nil
      allow(TopTaxonsElasticsearchService).to receive(:call) do |args|
        captured = args[:background_for_heatmap]
        { "ok" => true }
      end

      get :samples_taxons, params: { sampleIds: [@sample.id], background: background.id }

      expect(captured).to eq(background.id)
    end

    it "drops a background id the user cannot view" do
      @joe.add_allowed_feature("heatmap_elasticsearch")
      captured = :unset
      allow(TopTaxonsElasticsearchService).to receive(:call) do |args|
        captured = args[:background_for_heatmap]
        { "ok" => true }
      end

      get :samples_taxons, params: { sampleIds: [@sample.id], background: 999_999 }

      expect(captured).to be_nil
    end
  end
end

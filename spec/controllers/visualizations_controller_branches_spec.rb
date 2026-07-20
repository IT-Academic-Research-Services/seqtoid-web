require 'rails_helper'

# Branch-coverage spec for VisualizationsController.
#
# The existing controller + request specs cover index (my_data/public/sort),
# update (success + IDOR), save (new + reuse), shorten_url success, samples_taxons
# blank, heatmap_metrics, and the phylo_tree(_ng) redirect dispatch. This targets
# the arms they never reach:
#   * save: the rescue -> 500 "failed" arm
#   * shorten_url: the rescue -> 500 "failed" arm
#   * visualization#show: the table/tree redirect arm (redirect to /samples/:id)
#
# TEST-ONLY. Mutation-checked.
RSpec.describe VisualizationsController, type: :controller do
  create_users

  before { sign_in @joe }

  describe "POST #save failure handling (rescue arm)" do
    it "renders a 500 'failed' payload when the visualization cannot be persisted" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project, user: @joe)
      # Stub AFTER fixtures are built so factory saves are unaffected; the save!
      # inside the action then raises and drives the rescue.
      allow_any_instance_of(Visualization).to receive(:save!).and_raise(StandardError, "db down")

      post :save, params: { type: "heatmap", data: { sampleIds: [sample.id], foo: "bar" } }

      expect(response).to have_http_status(:internal_server_error)
      expect(JSON.parse(response.body)["status"]).to eq("failed")
    end
  end

  describe "POST #shorten_url failure handling (rescue arm)" do
    it "renders a 500 'failed' payload when URL shortening raises" do
      allow(Shortener::ShortenedUrl).to receive(:generate).and_raise(StandardError, "shortener down")

      post :shorten_url, params: { url: "https://czid.org/visualizations/heatmap/1" }

      expect(response).to have_http_status(:internal_server_error)
      expect(JSON.parse(response.body)["status"]).to eq("failed")
    end
  end

  describe "GET #visualization table/tree redirect arm" do
    it "redirects a 'table' visualization to its sample page" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project, user: @joe)
      # data must be non-blank (Visualization validates :data, presence: true);
      # the action mutates it (sets sampleIds/id) before redirecting.
      vis = create(:visualization, user_id: @joe.id, visualization_type: "table", name: "T", data: { "tableState" => [] })
      vis.samples << sample

      get :visualization, params: { type: "table", id: vis.id }

      expect(response).to have_http_status(:redirect)
      expect(response.location).to include("/samples/#{sample.id}")
    end
  end
end

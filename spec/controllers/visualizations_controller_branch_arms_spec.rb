require 'rails_helper'

# Branch coverage for the last two VisualizationsController arms the existing specs never take:
#   * samples_for_heatmap: the `id ? Visualization.find(id).sample_ids : params[:sampleIds]` arm
#     that resolves the sample set from a SAVED visualization rather than from request params
#   * update: the arm taken when the rename is rejected by validation
RSpec.describe VisualizationsController, type: :controller do
  create_users

  before do
    sign_in @joe
    @project = create(:project, users: [@joe])
    @sample = create(:sample, project: @project, user: @joe)
  end

  describe "GET #samples_taxons resolving samples from a saved visualization" do
    it "uses the saved visualization's samples instead of the sampleIds params" do
      other_sample = create(:sample, project: @project, user: @joe)
      vis = create(:visualization, user_id: @joe.id, visualization_type: "heatmap",
                                   name: "Saved heatmap", data: { "sampleIds" => [] })
      vis.samples << @sample

      captured_sample_ids = nil
      allow(HeatmapHelper).to receive(:sample_taxons_dict) do |_params, samples, _background|
        captured_sample_ids = samples.map(&:id)
        { "taxon" => 1 }
      end

      get :samples_taxons, params: { id: vis.id, sampleIds: [other_sample.id] }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("taxon" => 1)
      # The saved visualization wins: the sampleIds param is ignored entirely.
      expect(captured_sample_ids).to eq([@sample.id])
      expect(captured_sample_ids).not_to include(other_sample.id)
    end

    it "falls back to the sampleIds params when no visualization id is supplied" do
      other_sample = create(:sample, project: @project, user: @joe)

      captured_sample_ids = nil
      allow(HeatmapHelper).to receive(:sample_taxons_dict) do |_params, samples, _background|
        captured_sample_ids = samples.map(&:id)
        { "taxon" => 2 }
      end

      get :samples_taxons, params: { sampleIds: [other_sample.id] }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("taxon" => 2)
      expect(captured_sample_ids).to eq([other_sample.id])
    end
  end

  describe "PUT #update when the rename is rejected" do
    it "renames the visualization when the new name is valid" do
      vis = create(:visualization, user_id: @joe.id, visualization_type: "heatmap",
                                   name: "Before", data: { "sampleIds" => [] })

      put :update, params: { id: vis.id, name: "After" }

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["name"]).to eq("After")
      expect(vis.reload.name).to eq("After")
    end

    it "takes the failure arm and blows up on the unset @visualization instead of rendering an error" do
      vis = create(:visualization, user_id: @joe.id, visualization_type: "heatmap",
                                   name: "Keep me", data: { "sampleIds" => [] })

      # Visualization validates name presence, so a blank rename returns false from #update and the
      # controller enters its error arm. That arm references @visualization, which this action never
      # assigns -- so the request raises rather than rendering a 500 payload. Documented, not fixed here.
      expect { put :update, params: { id: vis.id, name: "" } }
        .to raise_error(NoMethodError, /undefined method .errors./)

      expect(vis.reload.name).to eq("Keep me")
    end
  end
end

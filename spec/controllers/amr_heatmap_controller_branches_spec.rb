require 'rails_helper'

# Branch-coverage spec for AmrHeatmapController#amr_counts.
#
# The existing amr_heatmap_controller_spec.rb covers loaded AMR counts, a
# not-found sample, an inaccessible sample, and a run whose amr_counts output
# state is absent. It never reaches:
#   * the `if pipeline_run` false arm (a viewable sample with NO pipeline run)
#   * the second operand of `amr_state.present? && state == STATUS_LOADED` being
#     false (an amr_counts output state that exists but is NOT loaded)
# Both arms must still yield an empty amrCounts (never leak un-loaded counts).
#
# TEST-ONLY. Mutation-checked.
RSpec.describe AmrHeatmapController, type: :controller do
  create_users

  before { sign_in @joe }

  describe "GET #amr_counts" do
    it "returns empty amrCounts for a viewable sample that has no pipeline run" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project) # no pipeline_runs_data

      get :amr_counts, params: { sampleIds: [sample.id] }

      expect(response).to have_http_status(:ok)
      row = JSON.parse(response.body).find { |r| r["sampleId"] == sample.id }
      expect(row["amrCounts"]).to eq([])
      # It is a found sample (present in viewable_samples), not the not-found path.
      expect(row["error"]).to eq("")
    end

    it "withholds counts when the amr_counts output state exists but is NOT loaded" do
      project = create(:project, users: [@joe])
      sample = create(:sample, project: project, pipeline_runs_data: [{
        amr_counts_data: [{ gene: "WithHeld_Gene" }],
        job_status: PipelineRun::STATUS_CHECKED,
        output_states_data: [{
          output: "amr_counts",
          state: PipelineRun::STATUS_UNKNOWN, # valid OutputState value, present but not LOADED
        }],
      }])

      get :amr_counts, params: { sampleIds: [sample.id] }

      expect(response).to have_http_status(:ok)
      row = JSON.parse(response.body).find { |r| r["sampleId"] == sample.id }
      # The counts exist on the run but the state is not LOADED, so they are withheld.
      expect(row["amrCounts"]).to eq([])
      expect(row["error"]).to eq("")
    end
  end
end

require 'rails_helper'

# Branch coverage for BackgroundsController. backgrounds_controller_spec drives the
# default index listing, the categorizeBackgrounds arm, and the unauthorized arm of
# #create. This file closes the arms it leaves undriven:
#   * index with ownedOrPublicBackgroundsOnly (the ternary's THEN arm)
#   * create when every requested sample IS viewable (the else arm), split into the
#     save-succeeds and save-fails sub-arms.
RSpec.describe BackgroundsController, type: :controller do
  create_users

  before do
    sign_in @joe

    @project_joe = create(:project, users: [@joe], name: "Branches Project Joe")
    @sample_joe_one = create(:sample, project: @project_joe, user: @joe, name: "Branches Sample Joe 1",
                                      pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
    @sample_joe_two = create(:sample, project: @project_joe, user: @joe, name: "Branches Sample Joe 2",
                                      pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
  end

  describe "GET #index" do
    it "returns only owned and public backgrounds when ownedOrPublicBackgroundsOnly is set" do
      owned = create(:background, name: "Branches Owned BG", user: @joe, pipeline_run_ids: [
                       @sample_joe_one.first_pipeline_run.id,
                       @sample_joe_two.first_pipeline_run.id,
                     ])
      public_bg = create(:background, name: "Branches Public BG", user: @admin, public_access: 1, pipeline_run_ids: [
                           @sample_joe_one.first_pipeline_run.id,
                           @sample_joe_two.first_pipeline_run.id,
                         ])

      get :index, format: :json, params: { ownedOrPublicBackgroundsOnly: true }

      expect(response).to have_http_status :ok
      json_response = JSON.parse(response.body)
      expect(json_response.keys).to contain_exactly("backgrounds")
      expect(json_response["backgrounds"].pluck("id")).to contain_exactly(owned.id, public_bg.id)
    end
  end

  describe "POST #create" do
    it "creates the background when every sample is viewable" do
      post :create, format: :json, params: {
        name: "Branches Created BG",
        description: "made by the branch spec",
        sample_ids: [@sample_joe_one.id, @sample_joe_two.id],
      }

      expect(response).to have_http_status :ok
      expect(JSON.parse(response.body)["status"]).to eq("ok")

      background = Background.find_by(name: "Branches Created BG")
      expect(background).to be_present
      expect(background.user_id).to eq(@joe.id)
      expect(background.description).to eq("made by the branch spec")
      expect(background.pipeline_run_ids).to contain_exactly(
        @sample_joe_one.first_pipeline_run.id,
        @sample_joe_two.first_pipeline_run.id
      )
    end

    it "returns the validation errors when the background cannot be saved" do
      # Same viewable samples, but a blank name fails the presence validation, so we
      # take the save-failed arm rather than the unauthorized arm.
      post :create, format: :json, params: {
        name: "",
        description: "invalid",
        sample_ids: [@sample_joe_one.id, @sample_joe_two.id],
      }

      expect(response).to have_http_status :ok
      body = JSON.parse(response.body)
      expect(body["status"]).to eq("not_acceptable")
      expect(body["message"]).to include("Name can't be blank")
      expect(Background.find_by(description: "invalid")).to be_nil
    end

    it "refuses when any requested sample is not viewable" do
      other_project = create(:project, users: [@admin])
      other_sample = create(:sample, project: other_project, user: @admin,
                                     pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])

      post :create, format: :json, params: {
        name: "Branches Unauthorized BG",
        sample_ids: [@sample_joe_one.id, other_sample.id],
      }

      body = JSON.parse(response.body)
      expect(body["status"]).to eq("unauthorized")
      expect(Background.find_by(name: "Branches Unauthorized BG")).to be_nil
    end
  end
end

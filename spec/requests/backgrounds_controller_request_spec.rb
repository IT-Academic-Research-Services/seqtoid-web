require 'rails_helper'

# Full-stack request specs for BackgroundsController.
#
# Focus: the login gate (before_action :login_required), the admin-only gate on
# destroy (before_action :admin_required, except: [:create, :show,
# :show_taxon_dist, :index]), the viewable-scoped authorization on show
# (set_viewable_background), and the create authorization branch that rejects
# sample_ids the current user cannot view. See
# app/controllers/backgrounds_controller.rb.
RSpec.describe "Backgrounds request", type: :request do
  create_users

  describe "GET /backgrounds.json (index, login required)" do
    it "returns 401 JSON when not signed in (authenticate_user! via Warden)" do
      get "/backgrounds.json"
      expect(response).to have_http_status(:unauthorized)
      expect(response.body).to include("Unauthorized")
    end

    it "returns viewable backgrounds for a signed-in user" do
      sign_in @joe
      # Background.viewable only surfaces a background to a non-admin when it is
      # public or all its pipeline_runs' samples are viewable by the user; the
      # factory's pipeline runs belong to other samples, so mark it public.
      bg = create(:background, user: @joe, public_access: 1)

      get "/backgrounds.json"

      expect(response).to have_http_status(:ok)
      ids = JSON.parse(response.body)["backgrounds"].map { |b| b["id"] }
      expect(ids).to include(bg.id)
    end

    it "splits owned vs other backgrounds when categorizeBackgrounds is set" do
      sign_in @joe
      mine = create(:background, user: @joe)

      get "/backgrounds.json", params: { categorizeBackgrounds: true }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body).to have_key("owned_backgrounds")
      expect(body).to have_key("other_backgrounds")
      expect(body["owned_backgrounds"].map { |b| b["id"] }).to include(mine.id)
    end
  end

  # SMP-1437: a signed-in user can view the details (description + member
  # samples) of a background they are authorized to see. Authorization is
  # enforced by BackgroundsController#set_viewable_background, which scopes the
  # lookup through Background.viewable(current_user).
  describe "GET /backgrounds/:id (show)" do
    it "returns a background's description and member samples to its owner" do
      sign_in @joe
      project = create(:project, users: [@joe], name: "Joe Project")
      sample_one = create(:sample, project: project, user: @joe, name: "Joe Sample 1",
                                   pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
      sample_two = create(:sample, project: project, user: @joe, name: "Joe Sample 2",
                                   pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
      bg = create(:background, user: @joe, description: "My controls",
                               pipeline_run_ids: [sample_one.first_pipeline_run.id, sample_two.first_pipeline_run.id])

      get "/backgrounds/#{bg.id}.json"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["description"]).to eq("My controls")
      expect(body["editable"]).to be(true)
      expect(body["sample_count"]).to eq(2)
      sample_names = body["samples"].map { |s| s["name"] }
      expect(sample_names).to contain_exactly("Joe Sample 1", "Joe Sample 2")
      expect(body["samples"].map { |s| s["project_name"] }.uniq).to eq(["Joe Project"])
    end

    it "lets a user view a public background even when they don't own it" do
      sign_in @joe
      bg = create(:background, user: @admin, public_access: 1, description: "Shared public")

      get "/backgrounds/#{bg.id}.json"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["description"]).to eq("Shared public")
      expect(body["editable"]).to be(false)
    end

    it "returns 404 when the background is not viewable by the user" do
      sign_in @joe
      admin_project = create(:project, users: [@admin], name: "Admin Private")
      s1 = create(:sample, project: admin_project, user: @admin, name: "Admin S1",
                           pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
      s2 = create(:sample, project: admin_project, user: @admin, name: "Admin S2",
                           pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
      bg = create(:background, user: @admin,
                               pipeline_run_ids: [s1.first_pipeline_run.id, s2.first_pipeline_run.id])

      get "/backgrounds/#{bg.id}.json"

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["message"]).to include("not authorized")
    end

    it "renders for an admin regardless of ownership" do
      sign_in @admin
      bg = create(:background, user: @admin)

      get "/backgrounds/#{bg.id}.json"

      expect(response).to have_http_status(:ok)
    end
  end

  describe "POST /backgrounds (create)" do
    before { sign_in @joe }

    it "rejects creation when a sample id is not viewable by the current user" do
      other_project = create(:project, users: [@admin])
      other_sample = create(:sample, project: other_project, user: @admin)

      expect do
        post "/backgrounds", params: { name: "Bad BG", sample_ids: [other_sample.id] }
      end.not_to change(Background, :count)

      body = JSON.parse(response.body)
      expect(body["message"]).to eq("You are not authorized to view all samples in the list.")
    end
  end

  describe "DELETE /backgrounds/:id (admin-only destroy)" do
    it "redirects a regular user to root_path" do
      sign_in @joe
      bg = create(:background, user: @joe)

      expect do
        delete "/backgrounds/#{bg.id}.json"
      end.not_to change(Background, :count)

      expect(response).to redirect_to(root_path)
    end

    it "destroys the background for an admin" do
      sign_in @admin
      bg = create(:background, user: @admin)

      expect do
        delete "/backgrounds/#{bg.id}.json"
      end.to change(Background, :count).by(-1)

      expect(response).to have_http_status(:no_content)
    end
  end
end

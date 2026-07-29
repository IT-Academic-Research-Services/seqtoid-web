require 'rails_helper'

# Branch-coverage companion for app/controllers/projects_controller.rb.
# The main spec never exercises:
#   - dimensions: the time_bins block (both the <= MAX_BINS day-granularity arm
#     and the > MAX_BINS bucketed arm) or the empty-projects arm, plus the
#     host&.id / host&.name mapping
#   - send_project_csv: both the "all" and single-project arms, and the
#     selected-sample-id filter arm
#   - update_project_visibility: the missing-access-value arm, the missing
#     project arm and the error render
#   - update: the failure arm of the respond_to block
RSpec.describe ProjectsController, type: :controller do
  create_users

  before do
    # dimensions/send_project_csv look these fields up by name; without them
    # LocationHelper.project_dimensions dereferences a nil MetadataField.
    create(:metadata_field, name: "collection_location", base_type: MetadataField::STRING_TYPE)
    create(:metadata_field, name: "collection_location_v2", base_type: MetadataField::LOCATION_TYPE)
    create(:metadata_field, name: "sample_type", base_type: MetadataField::STRING_TYPE)
    create(:metadata_field, name: "nucleotide_type", base_type: MetadataField::STRING_TYPE)
    sign_in @joe
  end

  describe "GET #dimensions" do
    it "returns empty time_bins when the domain has no projects" do
      get :dimensions, params: { format: "json", domain: "my_data" }

      expect(response).to have_http_status(:success)
      json_response = JSON.parse(response.body)
      time_bins = json_response.find { |dim| dim["dimension"] == "time_bins" }
      expect(time_bins["values"]).to eq([])
    end

    it "bins by day when the project date span is within MAX_BINS days" do
      create(:project, users: [@joe], created_at: 2.days.ago, samples_data: [{ user: @joe }])

      get :dimensions, params: { format: "json", domain: "my_data" }

      expect(response).to have_http_status(:success)
      json_response = JSON.parse(response.body)
      time_bins = json_response.find { |dim| dim["dimension"] == "time_bins" }
      # Day granularity yields plain YYYY-MM-DD values, one per day in the span.
      expect(time_bins["values"]).not_to be_empty
      expect(time_bins["values"].first["value"]).to match(/\A\d{4}-\d{2}-\d{2}\z/)
      expect(time_bins["values"].sum { |bin| bin["count"] }).to eq(1)
    end

    it "bins into MAX_BINS buckets when the project date span exceeds MAX_BINS days" do
      create(:project, users: [@joe], created_at: 2.years.ago, samples_data: [{ user: @joe }])
      create(:project, users: [@joe], created_at: Time.now.utc, samples_data: [{ user: @joe }])

      get :dimensions, params: { format: "json", domain: "my_data" }

      expect(response).to have_http_status(:success)
      json_response = JSON.parse(response.body)
      time_bins = json_response.find { |dim| dim["dimension"] == "time_bins" }
      expect(time_bins["values"].length).to eq(ProjectsController::MAX_BINS)
      # Bucketed values are "start:end" ranges rather than single dates, and every
      # bucket carries an interval instead of the day arm's bare date.
      expect(time_bins["values"].first["value"]).to include(":")
      expect(time_bins["values"]).to all(include("interval", "count"))
      expect(time_bins["values"].pluck("count")).to all(be_a(Integer))
    end

    it "reports host dimension values from the samples' host genomes" do
      host_genome = create(:host_genome, name: "BranchDimensionHost")
      create(:project, users: [@joe], samples_data: [{ user: @joe, host_genome: host_genome }])

      get :dimensions, params: { format: "json", domain: "my_data" }

      json_response = JSON.parse(response.body)
      host_dim = json_response.find { |dim| dim["dimension"] == "host" }
      expect(host_dim["values"].pluck("text")).to include("BranchDimensionHost")
      expect(host_dim["values"].pluck("value")).to include(host_genome.id)
    end
  end

  describe "GET #send_project_csv" do
    let(:pipeline_runs_data) { [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }] }
    let!(:project) do
      create(:project, users: [@joe], samples_data: [
               { name: "csv_sample_a", user: @joe, pipeline_runs_data: pipeline_runs_data },
               { name: "csv_sample_b", user: @joe, pipeline_runs_data: pipeline_runs_data },
             ])
    end

    it "sends a CSV for a single project" do
      get :send_project_csv, params: { id: project.id }

      expect(response).to have_http_status(:success)
      expect(response.headers["Content-Disposition"]).to include("#{project.cleaned_project_name}_sample-table.csv")
      expect(response.body).to include("csv_sample_a")
      expect(response.body).to include("csv_sample_b")
    end

    it "sends a CSV across all projects when id is 'all'" do
      get :send_project_csv, params: { id: "all" }

      expect(response).to have_http_status(:success)
      expect(response.headers["Content-Disposition"]).to include("all-projects_sample-table.csv")
    end

    it "restricts the CSV to the selected sample ids" do
      # Project#samples is deliberately nil (access must go through current_power).
      selected = Sample.find_by(name: "csv_sample_a")

      get :send_project_csv, params: { id: project.id, sampleIds: selected.id.to_s }

      expect(response).to have_http_status(:success)
      expect(response.body).to include("csv_sample_a")
      expect(response.body).not_to include("csv_sample_b")
    end
  end

  describe "PUT #update_project_visibility" do
    let!(:project) { create(:project, users: [@joe], public_access: 0) }

    it "updates the project when a public_access value is supplied" do
      put :update_project_visibility, params: { id: project.id, public_access: 1 }

      json_response = JSON.parse(response.body)
      expect(json_response["message"]).to eq("Project visibility updated successfully")
      expect(project.reload.public_access).to eq(1)
    end

    it "reports an error when the public_access value is missing" do
      put :update_project_visibility, params: { id: project.id }

      json_response = JSON.parse(response.body)
      expect(json_response["message"]).to eq("Unable to set visibility for project")
      expect(json_response["errors"]).to include("Access value is empty")
      expect(project.reload.public_access).to eq(0)
    end

    it "reports an error when the project could not be resolved" do
      # set_project normally raises RecordNotFound; bypass it so the action's own
      # "Project id is Invalid" guard is reached with @project still nil.
      allow(controller).to receive(:set_project) { controller.send(:assert_access) }

      put :update_project_visibility, params: { id: project.id, public_access: 1 }

      json_response = JSON.parse(response.body)
      expect(json_response["errors"]).to include("Project id is Invalid")
    end
  end

  describe "PUT #update" do
    let!(:project) { create(:project, users: [@joe], name: "Branch Update Project") }

    it "renders the updated project on success" do
      put :update, params: { format: "json", id: project.id, project: { name: "Branch Renamed Project" } }

      expect(response).to have_http_status(:ok)
      expect(project.reload.name).to eq("Branch Renamed Project")
    end

    it "renders the validation errors on failure" do
      create(:project, users: [@joe], name: "Already Taken Name")

      put :update, params: { format: "json", id: project.id, project: { name: "Already Taken Name" } }

      expect(JSON.parse(response.body).join(" ")).to match(/name/i)
      expect(project.reload.name).to eq("Branch Update Project")
    end
  end
end

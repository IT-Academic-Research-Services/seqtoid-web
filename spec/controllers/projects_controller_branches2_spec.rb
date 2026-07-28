# frozen_string_literal: true

require 'rails_helper'

# Branch-coverage companion #2 for app/controllers/projects_controller.rb.
# The main spec and companion #1 cover index, dimensions, send_project_csv,
# update_project_visibility, add_user and validate_sample_names. This file takes
# the arms they leave untaken:
#   - create: the validation-failure arm and the duplicate-name rescue
#   - destroy: the deletable and non-deletable arms
#   - validate_sample_names: the ignore_unuploaded arm
#   - metadata_fields: the single-project and multi-project arms
#   - show: the json arm
#   - all_users / validate_metadata_csv / upload_metadata
RSpec.describe ProjectsController, type: :controller do
  create_users

  before do
    create(:metadata_field, name: "collection_location", base_type: MetadataField::STRING_TYPE)
    create(:metadata_field, name: "collection_location_v2", base_type: MetadataField::LOCATION_TYPE)
    sign_in @joe
  end

  describe "POST #create" do
    it "renders the validation errors when the project cannot be saved" do
      post :create, params: { format: "json", project: { name: "" } }

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)).not_to be_empty
    end

    it "renders a duplicate-name message when the insert races another one" do
      allow_any_instance_of(Project).to receive(:save).and_raise(ActiveRecord::RecordNotUnique.new("dupe"))

      post :create, params: { format: "json", project: { name: "Branch Duplicate Project" } }

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.body).to eq("Duplicate name")
    end
  end

  describe "GET #show" do
    it "renders the project summary as json" do
      project = create(:project, users: [@joe], name: "Branch Show Project", public_access: 1)
      create(:sample, project: project, user: @joe)

      get :show, params: { format: "json", id: project.id }

      expect(response).to have_http_status(:success)
      body = JSON.parse(response.body)
      expect(body["name"]).to eq("Branch Show Project")
      expect(body["public_access"]).to eq(1)
      expect(body["total_sample_count"]).to eq(1)
    end
  end

  describe "DELETE #destroy" do
    it "destroys a project that has no samples" do
      project = create(:project, users: [@joe], name: "Branch Empty Project")

      delete :destroy, params: { format: "json", id: project.id }

      expect(response).to have_http_status(:no_content)
      expect(Project.where(id: project.id)).to be_empty
    end

    it "refuses to destroy a project that still has samples" do
      project = create(:project, users: [@joe], name: "Branch Full Project")
      create(:sample, project: project, user: @joe)

      delete :destroy, params: { format: "json", id: project.id }

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["message"]).to eq("Cannot delete this project")
      expect(Project.where(id: project.id)).to be_present
    end
  end

  describe "GET #all_users" do
    it "lists the name and email of every project member" do
      project = create(:project, users: [@joe], name: "Branch Users Project")

      get :all_users, params: { format: "json", id: project.id }

      expect(response).to have_http_status(:success)
      emails = JSON.parse(response.body)["users"].pluck("email")
      expect(emails).to include(@joe.email)
    end
  end

  describe "POST #validate_sample_names" do
    let(:project) { create(:project, users: [@joe], name: "Branch Names Project") }

    it "ignores samples that have not finished uploading when asked to" do
      create(:sample, project: project, user: @joe, name: "pending_sample", status: Sample::STATUS_CREATED)

      post :validate_sample_names, params: {
        format: "json", id: project.id, sample_names: ["pending_sample"], ignore_unuploaded: true,
      }

      expect(JSON.parse(response.body)).to eq(["pending_sample"])
    end

    it "renames a colliding sample when unuploaded samples are counted" do
      create(:sample, project: project, user: @joe, name: "pending_sample", status: Sample::STATUS_CREATED)

      post :validate_sample_names, params: {
        format: "json", id: project.id, sample_names: ["pending_sample"],
      }

      expect(JSON.parse(response.body)).to eq(["pending_sample_1"])
    end
  end

  describe "GET #metadata_fields" do
    let!(:field_one) do
      create(:metadata_field, name: "branch_field_one", display_name: "Branch Field One",
                              base_type: MetadataField::STRING_TYPE)
    end
    let!(:field_two) do
      create(:metadata_field, name: "branch_field_two", display_name: "Branch Field Two",
                              base_type: MetadataField::STRING_TYPE)
    end
    let!(:project_one) { create(:project, users: [@joe], name: "Branch MF One", metadata_fields: [field_one]) }
    let!(:project_two) { create(:project, users: [@joe], name: "Branch MF Two", metadata_fields: [field_two]) }

    it "returns the fields of a single project" do
      get :metadata_fields, params: { format: "json", projectIds: [project_one.id] }

      keys = JSON.parse(response.body).pluck("key")
      expect(keys).to include("branch_field_one")
      expect(keys).not_to include("branch_field_two")
    end

    it "returns the union of the fields across several projects" do
      get :metadata_fields, params: { format: "json", projectIds: [project_one.id, project_two.id] }

      keys = JSON.parse(response.body).pluck("key")
      expect(keys).to include("branch_field_one", "branch_field_two")
    end
  end

  describe "metadata upload endpoints" do
    let(:project) { create(:project, users: [@joe], name: "Branch Metadata Project") }

    it "reports validation issues for the submitted csv" do
      create(:sample, project: project, user: @joe, name: "branch_sample")

      post :validate_metadata_csv, params: {
        format: "json",
        id: project.id,
        metadata: { "headers" => %w[sample_name], "rows" => [["branch_sample"]] },
      }

      expect(response).to have_http_status(:success)
      body = JSON.parse(response.body)
      expect(body["status"]).to eq("success")
      expect(body["issues"]).to have_key("errors")
    end

    it "uploads metadata for the project samples" do
      field = create(:metadata_field, name: "branch_upload_field", display_name: "Branch Upload Field",
                                      base_type: MetadataField::STRING_TYPE)
      project.metadata_fields << field
      sample = create(:sample, project: project, user: @joe, name: "branch_upload_sample")
      sample.host_genome.metadata_fields << field

      post :upload_metadata, params: {
        format: "json",
        id: project.id,
        # upload_metadata_for_samples takes sample_name => { field => value }.
        metadata: { "branch_upload_sample" => { "branch_upload_field" => "Blood" } },
      }

      expect(response).to have_http_status(:success)
      expect(JSON.parse(response.body)["status"]).to eq("success")
      expect(sample.metadata.reload.find_by(key: "branch_upload_field")&.raw_value).to eq("Blood")
    end
  end
end

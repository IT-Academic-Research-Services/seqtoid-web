# frozen_string_literal: true

require "rails_helper"

# Regression coverage for SMP-1570: the top-level GraphQL `sample(sampleId:)` and `project(id:)`
# queries used a bare Sample.find / Project.find, so any logged-in user could read any sample or
# private project by supplying its id (an IDOR). The fix scopes both lookups through the current
# user's Power (viewable_samples / projects), so an unauthorized record raises RecordNotFound and
# surfaces the same "not found" an anonymous request would get -- no data leak, no existence oracle.
RSpec.describe "GraphQL object-scoping authorization (SMP-1570)", type: :request do
  create_users # @admin (role 1), @joe (role 0)

  describe "sample(sampleId:)" do
    it "denies a logged-in non-member reading a private sample by id" do
      owner_project = create(:project, users: [@admin], public_access: 0)
      sample = create(:sample, project: owner_project, user: @admin)

      sign_in @joe
      post "/graphql", params: { query: "{ sample(sampleId: #{sample.id}) { id name } }" }

      json = JSON.parse(response.body)
      expect(json.dig("data", "sample")).to be_nil
      expect(json["errors"].to_a.map { |e| e["message"] }).to include("Sample not found")
    end

    it "returns a sample the requester is a member of" do
      project = create(:project, users: [@joe], public_access: 0)
      sample = create(:sample, project: project, user: @joe)

      sign_in @joe
      post "/graphql", params: { query: "{ sample(sampleId: #{sample.id}) { id } }" }

      json = JSON.parse(response.body)
      expect(json["errors"]).to be_blank
      expect(json.dig("data", "sample", "id").to_i).to eq(sample.id)
    end

    it "still returns a public sample past its private-retention window to a non-member" do
      public_project = create(:project, users: [@admin], public_access: 1)
      sample = create(:sample, project: public_project, user: @admin, created_at: 366.days.ago)

      sign_in @joe
      post "/graphql", params: { query: "{ sample(sampleId: #{sample.id}) { id } }" }

      json = JSON.parse(response.body)
      expect(json["errors"]).to be_blank
      expect(json.dig("data", "sample", "id").to_i).to eq(sample.id)
    end
  end

  describe "project(id:)" do
    it "denies a logged-in non-member reading a private project's metadata by id" do
      project = create(:project, users: [@admin], public_access: 0, description: "secret")

      sign_in @joe
      post "/graphql", params: { query: "{ project(id: #{project.id}) { id name description } }" }

      json = JSON.parse(response.body)
      expect(json.dig("data", "project")).to be_nil
      expect(json["errors"].to_a.map { |e| e["message"] }).to include("Project not found")
    end

    it "returns a project the requester is a member of" do
      project = create(:project, users: [@joe], public_access: 0)

      sign_in @joe
      post "/graphql", params: { query: "{ project(id: #{project.id}) { id name } }" }

      json = JSON.parse(response.body)
      expect(json["errors"]).to be_blank
      expect(json.dig("data", "project", "id").to_i).to eq(project.id)
    end
  end
end

module Queries
  module ProjectQuery
    extend ActiveSupport::Concern

    included do
      field :project, Types::ProjectType, null: false do
        argument :id, Integer, required: true
      end
    end

    def project(id)
      current_power = context[:current_power]
      # Scope to projects the user may view (member/editable, public, or by domain) instead of a
      # bare Project.find, which leaked any project's name/description/access to any logged-in
      # user by id (the ProjectType half of SMP-1570). Not viewable -> RecordNotFound -> "Project
      # not found", same as the anonymous denial.
      project = current_power.projects.find(id[:id])
      samples = current_power.project_samples(project).order(id: :desc)

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        public_access: project.public_access.to_i,
        created_at: project.created_at,
        total_sample_count: samples.count,
      }
    rescue ActiveRecord::RecordNotFound
      raise GraphQL::ExecutionError, "Project not found"
    end
  end
end

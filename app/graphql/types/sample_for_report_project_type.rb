module Types
  # Federation mesh type `query_SampleForReport_project` (CZID-310).
  class SampleForReportProjectType < Types::BaseObject
    graphql_name "query_SampleForReport_project"

    field :id, String, null: true, camelize: false
    field :name, String, null: true, camelize: false
    field :pinned_alignment_config, String, null: true, camelize: false
  end
end

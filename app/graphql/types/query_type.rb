module Types
  class QueryType < Types::BaseObject
    # Add `node(id: ID!) and `nodes(ids: [ID!]!)`
    include GraphQL::Types::Relay::HasNodeField
    include GraphQL::Types::Relay::HasNodesField
    include ParameterSanitization
    include SamplesHelper
    include Queries::PathogenListQuery
    include Queries::ProjectQuery
    include Queries::SampleQuery
    include Queries::SampleListQuery
    include Queries::SampleReadsStatsListQuery
    include Queries::ZipLinkQuery
    include Queries::ValidateUserCanDeleteObjectsQuery
    include Queries::MetadataFieldsQuery
    include Queries::BulkDownloadCgOverviewQuery
    include Queries::SampleMetadataQuery
    # WorkflowRunsFetching supplies the shared discovery pipeline used by the fed*
    # discovery resolvers; it relies on current_user/current_power/SamplesHelper.
    include WorkflowRunsFetching
    include ProjectsDiscovery
    include Queries::FedWorkflowRunsQuery
    include Queries::FedConsensusGenomesQuery
    include Queries::FedSequencingReadsQuery
    include Queries::FedWorkflowRunsAggregateTotalCountQuery
    include Queries::FedBulkDownloadsQuery
    include Queries::FedWorkflowRunsAggregateQuery
    include Queries::SampleForReportQuery

    # Add root-level fields here.
    # They will be entry points for queries on your schema.
    field :app_config, AppConfigType, null: true do
      argument :id, ID, required: true
    end

    field :user, UserType, null: false do
      argument :email, String, required: true
      argument :name, String, required: true
      argument :institution, String, required: true
      argument :archetypes, String, required: true
      argument :segments, String, required: true
      argument :role, Int, required: true
    end

    def app_config(id:)
      AppConfig.find(id)
    end

    private

    # The fed* discovery resolvers and the shared WorkflowRunsFetching concern run in
    # this QueryType instance; expose the request's user/power the way controllers do
    # (GraphqlController seeds them into the GraphQL context).
    def current_user
      context[:current_user]
    end

    def current_power
      context[:current_power]
    end
  end
end

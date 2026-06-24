module Types
  # Federation mesh type
  # `query_SampleForReport_workflow_runs_items_parsed_cached_results` (CZID-310).
  class SampleForReportWorkflowRunParsedCachedResultsType < Types::BaseObject
    graphql_name "query_SampleForReport_workflow_runs_items_parsed_cached_results"

    field :quality_metrics, Types::SampleForReportWorkflowRunQualityMetricsType, null: true, camelize: false
  end
end

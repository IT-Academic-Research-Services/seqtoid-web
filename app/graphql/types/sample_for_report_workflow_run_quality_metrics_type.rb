module Types
  # Federation mesh type
  # `query_SampleForReport_workflow_runs_items_parsed_cached_results_quality_metrics`
  # (CZID-310).
  class SampleForReportWorkflowRunQualityMetricsType < Types::BaseObject
    graphql_name "query_SampleForReport_workflow_runs_items_parsed_cached_results_quality_metrics"

    field :total_reads, Int, null: true, camelize: false
    field :total_ercc_reads, Int, null: true, camelize: false
    field :adjusted_remaining_reads, Int, null: true, camelize: false
    field :percent_remaining, Float, null: true, camelize: false
    field :qc_percent, Float, null: true, camelize: false
    field :compression_ratio, Float, null: true, camelize: false
    field :insert_size_mean, Float, null: true, camelize: false
    field :insert_size_standard_deviation, Float, null: true, camelize: false
  end
end

module Types
  # Federation mesh type `query_SampleForReport_workflow_runs_items` (CZID-310): one entry
  # of Sample#workflow_runs_info. `id` is stringified.
  class SampleForReportWorkflowRunType < Types::BaseObject
    graphql_name "query_SampleForReport_workflow_runs_items"

    field :id, String, null: true, camelize: false
    field :status, String, null: true, camelize: false
    field :workflow, String, null: true, camelize: false
    field :wdl_version, String, null: true, camelize: false
    field :executed_at, String, null: true, camelize: false
    field :deprecated, Boolean, null: true, camelize: false
    field :input_error, Types::SampleForReportWorkflowRunInputErrorType, null: true, camelize: false
    field :inputs, Types::SampleForReportWorkflowRunInputsType, null: true, camelize: false
    field :parsed_cached_results, Types::SampleForReportWorkflowRunParsedCachedResultsType, null: true, camelize: false
    field :run_finalized, Boolean, null: true, camelize: false
    field :rails_workflow_run_id, String, null: true, camelize: false
  end
end

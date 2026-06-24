module Types
  # Federation mesh type `query_SampleForReport_workflow_runs_items_input_error` (CZID-310).
  class SampleForReportWorkflowRunInputErrorType < Types::BaseObject
    graphql_name "query_SampleForReport_workflow_runs_items_input_error"

    field :label, String, null: true, camelize: false
    field :message, String, null: true, camelize: false
  end
end

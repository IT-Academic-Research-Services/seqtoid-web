module Types
  # Federation mesh type `SampleForReport` (CZID-310): the sample-report payload for the
  # SampleView page, mapped from SamplesController#show (GET /samples/:id.json) with the
  # federation's id-stringification.
  class SampleForReportType < Types::BaseObject
    graphql_name "SampleForReport"

    field :id, String, null: true, camelize: false
    field :railsSampleId, String, null: true, camelize: false
    field :name, String, null: true, camelize: false
    field :created_at, String, null: true, camelize: false
    field :updated_at, String, null: true, camelize: false
    field :project_id, Int, null: true, camelize: false
    field :status, String, null: true, camelize: false
    field :host_genome_id, Int, null: true, camelize: false
    field :user_id, Int, null: true, camelize: false
    field :upload_error, String, null: true, camelize: false
    field :initial_workflow, String, null: true, camelize: false
    field :project, Types::SampleForReportProjectType, null: true, camelize: false
    field :default_background_id, Int, null: true, camelize: false
    field :default_pipeline_run_id, String, null: true, camelize: false
    field :editable, Boolean, null: true, camelize: false
    field :pipeline_runs, [Types::SampleForReportPipelineRunType], null: true, camelize: false
    field :workflow_runs, [Types::SampleForReportWorkflowRunType], null: true, camelize: false
  end
end

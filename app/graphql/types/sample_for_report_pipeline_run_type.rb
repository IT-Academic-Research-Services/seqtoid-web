module Types
  # Federation mesh type `query_SampleForReport_pipeline_runs_items` (CZID-310): one entry
  # of Sample#pipeline_runs_info. `id` is stringified.
  class SampleForReportPipelineRunType < Types::BaseObject
    graphql_name "query_SampleForReport_pipeline_runs_items"

    field :id, String, null: true, camelize: false
    field :pipeline_version, String, null: true, camelize: false
    field :wdl_version, String, null: true, camelize: false
    field :created_at, String, null: true, camelize: false
    field :alignment_config_name, String, null: true, camelize: false
    field :assembled, Int, null: true, camelize: false
    field :adjusted_remaining_reads, Int, null: true, camelize: false
    field :total_ercc_reads, Int, null: true, camelize: false
    field :run_finalized, Boolean, null: true, camelize: false
  end
end

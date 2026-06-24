module Types
  # Federation mesh type `query_SampleForReport_workflow_runs_items_inputs` (CZID-310).
  class SampleForReportWorkflowRunInputsType < Types::BaseObject
    graphql_name "query_SampleForReport_workflow_runs_items_inputs"

    field :accession_id, String, null: true, camelize: false
    field :accession_name, String, null: true, camelize: false
    field :taxon_id, String, null: true, camelize: false
    field :taxon_name, String, null: true, camelize: false
    field :technology, String, null: true, camelize: false
    field :ref_fasta, String, null: true, camelize: false
    field :creation_source, String, null: true, camelize: false
    field :card_version, String, null: true, camelize: false
    field :wildcard_version, String, null: true, camelize: false
  end
end

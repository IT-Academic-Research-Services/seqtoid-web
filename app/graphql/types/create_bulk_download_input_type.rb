module Types
  # Federation mesh input `mutationInput_CreateBulkDownload_input_Input` (CZID-304),
  # shared by CreateBulkDownload and createAsyncBulkDownload. Field names are camelCase on
  # the wire (default camelize) with snake readers for the resolver. workflowRunIdsStrings
  # supersedes workflowRunIds during the id-as-string migration. authenticityToken is
  # accepted for parity but unused.
  class CreateBulkDownloadInputType < Types::BaseInputObject
    graphql_name "mutationInput_CreateBulkDownload_input_Input"

    argument :download_type, String, required: false
    argument :workflow_run_ids, [Int, { null: true }], required: false
    argument :workflow_run_ids_strings, [String, { null: true }], required: false
    argument :workflow, String, required: false
    argument :download_format, String, required: false
    argument :authenticity_token, String, required: false
  end
end

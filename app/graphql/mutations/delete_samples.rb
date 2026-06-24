module Mutations
  # Ported from the federation server (resolver-functions/DeleteSamples) as part of
  # CZID-304. Serves `DeleteSamples` natively instead of proxying POST /samples/bulk_delete.
  # Reproduces SamplesController#bulk_delete exactly: re-validate the selected ids
  # (DeletionValidationService), require all of them to be eligible, then delete via
  # BulkDeletionService — and map {deletedIds, error} to the federation's
  # {deleted_workflow_ids, error} contract.
  class DeleteSamples < Mutations::BaseMutation
    graphql_name "DeleteSamples"

    argument :input, Types::DeleteSamplesInputType, required: false

    field :deleted_workflow_ids, [String], null: true, camelize: false
    field :error, String, null: true

    def resolve(input:)
      selected_ids = input.ids_strings.nil? ? input.ids : input.ids_strings
      workflow = input.workflow
      user = context[:current_user]

      validated_objects = DeletionValidationService.call(query_ids: selected_ids, user: user, workflow: workflow)
      return { deleted_workflow_ids: [], error: validated_objects[:error] } unless validated_objects[:error].nil?

      valid_ids = validated_objects[:valid_ids]
      if valid_ids.length != Array(selected_ids).length
        LogUtil.log_error(
          "Bulk delete failed: not all objects valid for deletion",
          selected_ids: selected_ids,
          workflow: workflow
        )
        return { deleted_workflow_ids: [], error: "Bulk delete failed: not all objects valid for deletion" }
      end

      deletion_response = BulkDeletionService.call(object_ids: valid_ids, user: user, workflow: workflow)
      {
        deleted_workflow_ids: Array(deletion_response[:deleted_run_ids]).map(&:to_s),
        error: deletion_response[:error],
      }
    end
  end
end

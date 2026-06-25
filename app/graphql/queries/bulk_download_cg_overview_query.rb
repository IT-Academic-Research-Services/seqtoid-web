module Queries
  # Ported from the GraphQL federation server (resolver-functions/BulkDownloadsCGOverview)
  # as part of CZID-285. Mirrors BulkDownloadsController#consensus_genome_overview_data:
  # validate viewable objects (the same create-validation chain), then build the CG
  # overview CSV rows. Includes BulkDownloadsHelper for validate_bulk_download_create_params.
  module BulkDownloadCgOverviewQuery
    extend ActiveSupport::Concern
    include BulkDownloadsHelper
    # validate_bulk_download_create_params → validate_num_objects calls get_app_config, which
    # lives in AppConfigHelper. Controllers auto-include all helpers; the GraphQL QueryType does
    # not, so include it explicitly or the resolver raises NoMethodError. (CZID-307 parity)
    include AppConfigHelper

    included do
      field :BulkDownloadCGOverview,
            Types::BulkDownloadCgOverviewType,
            null: false,
            camelize: false,
            resolver_method: :resolve_bulk_download_cg_overview do
        argument :input, Types::BulkDownloadCgOverviewInputType, required: true
      end
    end

    def resolve_bulk_download_cg_overview(input:)
      current_user = context[:current_user]
      workflow_run_ids =
        if input.workflow_run_ids_strings.present?
          input.workflow_run_ids_strings.map { |id| id && id.to_i }
        else
          input.workflow_run_ids
        end

      bulk_download_params = {
        download_type: input.download_type,
        workflow: input.workflow,
        workflow_run_ids: workflow_run_ids,
        params: {
          include_metadata: { value: input.include_metadata },
          sample_ids: { value: workflow_run_ids },
          workflow: { value: input.workflow },
        },
      }

      viewable_objects = validate_bulk_download_create_params(bulk_download_params, current_user)
      workflow_runs = WorkflowRun.where(id: viewable_objects.active.pluck(:id))
      rows = BulkDownloadsHelper.generate_cg_overview_data(
        workflow_runs: workflow_runs,
        include_metadata: input.include_metadata
      )

      { cgOverviewRows: rows }
    end
  end
end

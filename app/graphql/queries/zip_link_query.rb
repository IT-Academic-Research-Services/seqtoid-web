module Queries
  # Ported from the GraphQL federation server (resolver-functions/Ziplink) as part of
  # CZID-285 — serve the `ZipLink` query natively from Rails instead of proxying
  # GET /workflow_runs/:id/zip_link.json. Mirrors WorkflowRunsController#zip_link.
  module ZipLinkQuery
    extend ActiveSupport::Concern

    included do
      field :ZipLink, Types::ZipLinkType, null: false, camelize: false, resolver_method: :resolve_zip_link do
        argument :workflow_run_id, String, required: false, camelize: true
      end
    end

    def resolve_zip_link(workflow_run_id: nil)
      current_power = context[:current_power]
      workflow_run = current_power.workflow_runs.find(workflow_run_id)
      workflow_class = WorkflowRun::WORKFLOW_CLASS[workflow_run.workflow]
      workflow_run = workflow_class ? workflow_run.becomes(workflow_class) : workflow_run
      path = workflow_run.zip_link
      if path
        { url: path, error: nil }
      else
        # Parity (CZID-307): WorkflowRunsController#zip_link renders HTTP 404 when there is no
        # output, and the federation Ziplink resolver returns `res.statusText` (the HTTP reason
        # phrase, "Not Found") — NOT the JSON body ("Output not available"). Mirror that exactly.
        { url: nil, error: "Not Found" }
      end
    rescue ActiveRecord::RecordNotFound
      # A non-viewable / missing run is likewise a 404 → statusText "Not Found" via the federation.
      { url: nil, error: "Not Found" }
    end
  end
end

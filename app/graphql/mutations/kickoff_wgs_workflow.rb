module Mutations
  # Ported from the federation server (resolver-functions/KickoffWGSWorkflow) as part of
  # CZID-304. Serves `KickoffWGSWorkflow` natively instead of proxying
  # POST /samples/:id/kickoff_workflow. Mirrors SamplesController#kickoff_workflow: scope
  # to current_power.updatable_samples, create + dispatch the workflow run, and return
  # Sample#workflow_runs_info with each item id stringified (the federation post-processing).
  class KickoffWgsWorkflow < Mutations::BaseMutation
    graphql_name "KickoffWGSWorkflow"

    argument :sample_id, String, required: false
    argument :input, Types::KickoffWgsWorkflowInputType, required: false

    type [Types::KickoffWgsWorkflowItemType], null: true

    def resolve(input:, sample_id: nil)
      sample = context[:current_power].updatable_samples.find(sample_id.to_i)
      inputs_json = input.inputs_json&.to_h&.to_json

      sample.create_and_dispatch_workflow_run(input.workflow, context[:current_user].id, inputs_json: inputs_json)

      sample.workflow_runs_info.map { |item| item.merge("id" => item["id"].to_s) }
    rescue Sample::SampleDeletedError => e
      # SMP-1768 -- the sample was deleted (e.g. by data retention) after the client loaded
      # it. Surface a clean GraphQL error the consensus genome creation modal can show
      # instead of creating a dangling forked workflow run.
      raise GraphQL::ExecutionError, e.message
    rescue SfnCgPipelineDispatchService::MngsInputsUnavailableError => e
      # SMP-1566 -- a CG run kicked off from an mNGS report starts from that run's retained
      # non-host reads. If the sample has no completed mNGS run those reads do not exist, so
      # surface a clean GraphQL error the creation modal can show rather than dispatching a
      # run that could never succeed.
      raise GraphQL::ExecutionError, e.message
    end
  end
end

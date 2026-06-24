module Types
  # The discovery filter bag for fedSequencingReads (CZID-285). camelCase on the wire,
  # snake readers for the resolver. Note `taxons` (plural).
  class FedSequencingReadsTodoRemoveInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_todoRemove_Input"

    argument :domain, String, required: false
    argument :workflow, String, required: false
    argument :project_id, String, required: false
    argument :visibility, String, required: false
    argument :search, String, required: false
    argument :time, [String], required: false
    argument :host, [Int], required: false
    argument :taxa_levels, [String], required: false
    argument :taxons, [Int], required: false
    argument :location_v2, [String], required: false
    argument :tissue, [String], required: false
    argument :order_by, String, required: false
    argument :order_dir, String, required: false
    argument :sample_ids, [Int], required: false
    argument :workflow_run_ids, [Int], required: false
  end
end

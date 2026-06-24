module Types
  # `limitOffset` pagination for fedSequencingReads (CZID-285).
  class FedSequencingReadsLimitOffsetInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_limitOffset_Input"

    argument :limit, Int, required: false, camelize: false
    argument :offset, Int, required: false, camelize: false
  end
end

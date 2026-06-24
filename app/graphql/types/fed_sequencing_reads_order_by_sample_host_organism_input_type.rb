module Types
  # `orderByArray[].sample.hostOrganism` for fedSequencingReads (CZID-285).
  class FedSequencingReadsOrderBySampleHostOrganismInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_orderByArray_items_sample_hostOrganism_Input"

    argument :name, String, required: false, camelize: false
  end
end

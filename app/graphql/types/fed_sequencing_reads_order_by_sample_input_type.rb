module Types
  # `orderByArray[].sample` for fedSequencingReads (CZID-285).
  class FedSequencingReadsOrderBySampleInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_orderByArray_items_sample_Input"

    argument :name, String, required: false, camelize: false
    argument :notes, String, required: false, camelize: false
    argument :sampleType, String, required: false, camelize: false
    argument :waterControl, String, required: false, camelize: false
    argument :collectionLocation, String, required: false, camelize: false
    argument :hostOrganism, Types::FedSequencingReadsOrderBySampleHostOrganismInputType, required: false, camelize: false
    argument :metadata, Types::FedSequencingReadsOrderBySampleMetadataInputType, required: false, camelize: false
  end
end

module Types
  # `orderByArray[].sample.metadata` for fedSequencingReads (CZID-285).
  class FedSequencingReadsOrderBySampleMetadataInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_orderByArray_items_sample_metadata_Input"

    argument :fieldName, String, required: false, camelize: false
    argument :dir, String, required: false, camelize: false
  end
end

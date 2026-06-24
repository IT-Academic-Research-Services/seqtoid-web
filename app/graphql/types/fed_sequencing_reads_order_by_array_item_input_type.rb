module Types
  # An `orderByArray` item for fedSequencingReads (CZID-285). Ordering is applied via
  # todoRemove.orderBy/orderDir; modeled so the frontend input validates.
  class FedSequencingReadsOrderByArrayItemInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_orderByArray_items_Input"

    argument :protocol, String, required: false, camelize: false
    argument :technology, String, required: false, camelize: false
    argument :medakaModel, String, required: false, camelize: false
    argument :nucleicAcid, String, required: false, camelize: false
    argument :sample, Types::FedSequencingReadsOrderBySampleInputType, required: false, camelize: false
  end
end

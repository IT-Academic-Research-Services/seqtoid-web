module Types
  # `where.sample` filter for fedSequencingReads (CZID-285).
  class FedSequencingReadsWhereSampleInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_where_sample_Input"

    argument :name, Types::StringIregexFilterType, required: false, camelize: false
    argument :collectionLocation, Types::StringListInFilterType, required: false, camelize: false
    argument :hostOrganism, Types::FedSequencingReadsWhereSampleHostOrganismInputType, required: false, camelize: false
    argument :sampleType, Types::StringListInFilterType, required: false, camelize: false
  end
end

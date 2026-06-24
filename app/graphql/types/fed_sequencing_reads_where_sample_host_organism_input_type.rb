module Types
  # `where.sample.hostOrganism` filter for fedSequencingReads (CZID-285).
  class FedSequencingReadsWhereSampleHostOrganismInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_where_sample_hostOrganism_Input"

    argument :name, Types::StringListInFilterType, required: false, camelize: false
  end
end

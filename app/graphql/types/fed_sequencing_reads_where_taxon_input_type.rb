module Types
  # `where.taxon` filter for fedSequencingReads (CZID-285).
  class FedSequencingReadsWhereTaxonInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_where_taxon_Input"

    argument :name, Types::StringListInFilterType, required: false, camelize: false
  end
end

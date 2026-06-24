module Types
  # `where.consensusGenomes.taxon` filter for fedSequencingReads (CZID-285).
  class FedSequencingReadsWhereConsensusGenomesTaxonInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_where_consensusGenomes_taxon_Input"

    argument :name, Types::StringListInFilterType, required: false, camelize: false
  end
end

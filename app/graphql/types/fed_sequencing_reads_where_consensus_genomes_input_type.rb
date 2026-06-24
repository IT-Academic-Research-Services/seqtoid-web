module Types
  # `where.consensusGenomes` filter for fedSequencingReads (CZID-285).
  class FedSequencingReadsWhereConsensusGenomesInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_where_consensusGenomes_Input"

    argument :producingRunId, Types::StringListInFilterType, required: false, camelize: false
    argument :taxon, Types::FedSequencingReadsWhereConsensusGenomesTaxonInputType, required: false, camelize: false
  end
end

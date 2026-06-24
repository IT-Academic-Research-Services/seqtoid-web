module Types
  # `where` filter for fedSequencingReads (CZID-285). Modeled so the frontend input
  # validates; the federation forwarded discovery filters via todoRemove, so the
  # resolver does likewise.
  class FedSequencingReadsWhereInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_where_Input"

    argument :id, Types::StringListInFilterType, required: false, camelize: false
    argument :collectionId, Types::IntListInFilterType, required: false, camelize: false
    argument :sample, Types::FedSequencingReadsWhereSampleInputType, required: false, camelize: false
    argument :taxon, Types::FedSequencingReadsWhereTaxonInputType, required: false, camelize: false
    argument :consensusGenomes, Types::FedSequencingReadsWhereConsensusGenomesInputType, required: false, camelize: false
  end
end

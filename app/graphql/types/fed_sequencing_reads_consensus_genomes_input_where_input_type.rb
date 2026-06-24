module Types
  # `consensusGenomesInput.where` for fedSequencingReads (CZID-285).
  class FedSequencingReadsConsensusGenomesInputWhereInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_consensusGenomesInput_where_Input"

    argument :producingRunId, Types::StringListInFilterType, required: false, camelize: false
  end
end

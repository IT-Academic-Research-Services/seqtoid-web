module Types
  # `consensusGenomesInput` for fedSequencingReads (CZID-285).
  class FedSequencingReadsConsensusGenomesInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_consensusGenomesInput_Input"

    argument :where, Types::FedSequencingReadsConsensusGenomesInputWhereInputType, required: false, camelize: false
  end
end

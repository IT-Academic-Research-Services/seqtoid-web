module Types
  # Federation mesh type `query_fedSequencingReads_items_consensusGenomes` (CZID-285):
  # the CG workflow runs for this sample, one edge per run.
  class FedSequencingReadsConsensusGenomesType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_consensusGenomes"

    field :edges, [Types::FedSequencingReadsConsensusGenomesEdgeType], null: false, camelize: false
  end
end

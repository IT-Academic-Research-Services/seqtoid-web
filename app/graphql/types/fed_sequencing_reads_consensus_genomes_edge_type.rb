module Types
  # Federation mesh type
  # `query_fedSequencingReads_items_consensusGenomes_edges_items` (CZID-285).
  class FedSequencingReadsConsensusGenomesEdgeType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_consensusGenomes_edges_items"

    field :node, Types::FedSequencingReadsConsensusGenomesNodeType, null: false, camelize: false
  end
end

module Types
  # Federation mesh type
  # `query_fedSequencingReads_items_consensusGenomes_edges_items_node_referenceGenome`
  # (CZID-285).
  class FedSequencingReadsConsensusGenomesNodeReferenceGenomeType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_consensusGenomes_edges_items_node_referenceGenome"

    field :accessionId, String, null: true, camelize: false
    field :accessionName, String, null: true, camelize: false
  end
end

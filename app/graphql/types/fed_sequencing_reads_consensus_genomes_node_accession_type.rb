module Types
  # Federation mesh type
  # `query_fedSequencingReads_items_consensusGenomes_edges_items_node_accession`
  # (CZID-285).
  class FedSequencingReadsConsensusGenomesNodeAccessionType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_consensusGenomes_edges_items_node_accession"

    field :accessionId, String, null: true, camelize: false
    field :accessionName, String, null: true, camelize: false
  end
end

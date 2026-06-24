module Types
  # Federation mesh type
  # `query_fedSequencingReads_items_consensusGenomes_edges_items_node_taxon` (CZID-285).
  class FedSequencingReadsConsensusGenomesNodeTaxonType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_consensusGenomes_edges_items_node_taxon"

    field :name, String, null: true, camelize: false
    field :level, String, null: true, camelize: false
  end
end

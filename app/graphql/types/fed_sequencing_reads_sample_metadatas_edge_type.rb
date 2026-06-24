module Types
  # Federation mesh type `query_fedSequencingReads_items_sample_metadatas_edges_items`
  # (CZID-285).
  class FedSequencingReadsSampleMetadatasEdgeType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_sample_metadatas_edges_items"

    field :node, Types::FedSequencingReadsSampleMetadatasNodeType, null: false, camelize: false
  end
end

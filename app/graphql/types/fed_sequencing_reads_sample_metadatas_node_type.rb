module Types
  # Federation mesh type
  # `query_fedSequencingReads_items_sample_metadatas_edges_items_node` (CZID-285): one
  # metadata field/value pair (from getMetadataEdges).
  class FedSequencingReadsSampleMetadatasNodeType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_sample_metadatas_edges_items_node"

    field :fieldName, String, null: true, camelize: false
    field :value, String, null: true, camelize: false
  end
end

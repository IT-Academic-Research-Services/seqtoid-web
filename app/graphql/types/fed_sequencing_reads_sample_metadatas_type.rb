module Types
  # Federation mesh type `query_fedSequencingReads_items_sample_metadatas` (CZID-285).
  class FedSequencingReadsSampleMetadatasType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_sample_metadatas"

    field :edges, [Types::FedSequencingReadsSampleMetadatasEdgeType], null: false, camelize: false
  end
end

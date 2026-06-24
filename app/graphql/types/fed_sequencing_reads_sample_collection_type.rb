module Types
  # Federation mesh type `query_fedSequencingReads_items_sample_collection` (CZID-285).
  class FedSequencingReadsSampleCollectionType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_sample_collection"

    field :name, String, null: true, camelize: false
    field :public, Boolean, null: true, camelize: false
  end
end

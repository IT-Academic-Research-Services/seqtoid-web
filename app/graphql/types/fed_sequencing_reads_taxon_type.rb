module Types
  # Federation mesh type `query_fedSequencingReads_items_taxon` (CZID-285).
  class FedSequencingReadsTaxonType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_taxon"

    field :name, String, null: true, camelize: false
    field :level, String, null: true, camelize: false
  end
end

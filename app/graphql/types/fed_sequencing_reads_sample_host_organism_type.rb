module Types
  # Federation mesh type `query_fedSequencingReads_items_sample_hostOrganism` (CZID-285).
  class FedSequencingReadsSampleHostOrganismType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_sample_hostOrganism"

    field :name, String, null: true, camelize: false
  end
end

module Types
  # Federation mesh type `query_fedSequencingReads_items_sample` (CZID-285).
  class FedSequencingReadsSampleType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_sample"

    field :railsSampleId, Int, null: true, camelize: false
    field :name, String, null: true, camelize: false
    field :notes, String, null: true, camelize: false
    field :collectionLocation, String, null: true, camelize: false
    field :sampleType, String, null: true, camelize: false
    field :waterControl, Boolean, null: true, camelize: false
    field :uploadError, String, null: true, camelize: false
    field :hostOrganism, Types::FedSequencingReadsSampleHostOrganismType, null: true, camelize: false
    field :collection, Types::FedSequencingReadsSampleCollectionType, null: true, camelize: false
    field :ownerUserId, Float, null: true, camelize: false
    field :ownerUserName, String, null: true, camelize: false
    field :metadatas, Types::FedSequencingReadsSampleMetadatasType, null: false, camelize: false
  end
end

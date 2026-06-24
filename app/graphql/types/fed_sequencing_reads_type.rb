module Types
  # Federation mesh type `query_fedSequencingReads_items` (CZID-285, 303b): one
  # discovery-view sequencing read (a sample), aggregating its consensus-genome workflow
  # runs into consensusGenomes.edges. Mapped from /workflow_runs.json
  # (mode: with_sample_info).
  class FedSequencingReadsType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items"

    field :id, String, null: false, camelize: false
    field :nucleicAcid, String, null: false, camelize: false
    field :protocol, String, null: true, camelize: false
    field :medakaModel, String, null: true, camelize: false
    field :technology, String, null: false, camelize: false
    field :taxon, Types::FedSequencingReadsTaxonType, null: true, camelize: false
    field :sample, Types::FedSequencingReadsSampleType, null: true, camelize: false
    field :consensusGenomes, Types::FedSequencingReadsConsensusGenomesType, null: false, camelize: false
  end
end

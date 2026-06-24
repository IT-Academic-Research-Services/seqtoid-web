module Types
  # Federation mesh type
  # `query_fedSequencingReads_items_consensusGenomes_edges_items_node` (CZID-285).
  class FedSequencingReadsConsensusGenomesNodeType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_consensusGenomes_edges_items_node"

    field :producingRunId, String, null: true, camelize: false
    field :taxon, Types::FedSequencingReadsConsensusGenomesNodeTaxonType, null: true, camelize: false
    field :referenceGenome, Types::FedSequencingReadsConsensusGenomesNodeReferenceGenomeType, null: true, camelize: false
    field :accession, Types::FedSequencingReadsConsensusGenomesNodeAccessionType, null: true, camelize: false
    field :metrics, Types::FedSequencingReadsConsensusGenomesNodeMetricsType, null: true, camelize: false
  end
end

module Types
  # Federation mesh type
  # `query_fedSequencingReads_items_consensusGenomes_edges_items_node_metrics`
  # (CZID-285): per-CG-run quality metrics from the run's cached_results.
  class FedSequencingReadsConsensusGenomesNodeMetricsType < Types::BaseObject
    graphql_name "query_fedSequencingReads_items_consensusGenomes_edges_items_node_metrics"

    field :coverageDepth, Float, null: true, camelize: false
    field :totalReads, Int, null: true, camelize: false
    field :gcPercent, Float, null: true, camelize: false
    field :refSnps, Int, null: true, camelize: false
    field :percentIdentity, Float, null: true, camelize: false
    field :nActg, Int, null: true, camelize: false
    field :percentGenomeCalled, Float, null: true, camelize: false
    field :nMissing, Int, null: true, camelize: false
    field :nAmbiguous, Int, null: true, camelize: false
    field :referenceGenomeLength, Float, null: true, camelize: false
  end
end

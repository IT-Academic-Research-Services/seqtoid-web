module Queries
  # Ported from the GraphQL federation server (resolver-functions/fedSequencingReads) as
  # part of CZID-285 (303b). Serves `fedSequencingReads` natively from Rails instead of
  # proxying GET /workflow_runs.json. Two modes, matching the federation resolver:
  #
  #   1. ids-only: when the selection set is just `{ id }`. Runs the shared pipeline in
  #      mode: basic and returns the unique sample ids. The federation detected this by
  #      regex on the raw query string; we use the graphql-ruby lookahead instead.
  #   2. full: mode with_sample_info — builds the sample subtree and aggregates each
  #      sample's consensus-genome workflow runs into consensusGenomes.edges (dedup by
  #      sample id).
  module FedSequencingReadsQuery
    extend ActiveSupport::Concern

    # Metadata fields promoted to first-class sample fields, excluded from the generic
    # metadatas edge list (mirrors the federation getMetadataEdges util).
    METADATA_EDGE_EXCLUSIONS = %w[nucleotide_type collection_location_v2 sample_type water_control].freeze

    included do
      field :fedSequencingReads,
            [Types::FedSequencingReadsType],
            null: true,
            camelize: false,
            extras: [:lookahead],
            resolver_method: :resolve_fed_sequencing_reads do
        argument :input, Types::FedSequencingReadsInputType, required: false
      end
    end

    def resolve_fed_sequencing_reads(lookahead:, input: nil)
      raise GraphQL::ExecutionError, "fedSequencingReads input is nullish" if input.nil?

      ids_only = ids_only_selection?(lookahead)
      td = input.todoRemove

      result = discovery_workflow_runs(
        domain: td&.domain,
        filters: {
          search: td&.search,
          host: td&.host,
          locationV2: td&.location_v2,
          tissue: td&.tissue,
          projectId: td&.project_id,
          visibility: td&.visibility,
          time: td&.time,
          workflow: td&.workflow,
          taxon: td&.taxons,
          sampleIds: td&.sample_ids,
          workflowRunIds: td&.workflow_run_ids,
        },
        mode: ids_only ? "basic" : "with_sample_info",
        order_by: td&.order_by,
        order_dir: td&.order_dir,
        offset: ids_only ? 0 : (input.offset || input.limitOffset&.offset || 0),
        limit: ids_only ? Queries::FedWorkflowRunsQuery::DISCOVERY_LIMIT : (input.limit || input.limitOffset&.limit || WorkflowRunsController::MAX_PAGE_SIZE)
      )

      runs = result[:workflow_runs].as_json

      if ids_only
        runs.map { |run| run.dig("sample", "info", "id").to_s }.uniq.map { |id| { id: id } }
      else
        build_sequencing_reads(runs)
      end
    end

    private

    def ids_only_selection?(lookahead)
      selected = lookahead.selections.map { |selection| selection.field.graphql_name }
      selected == ["id"]
    end

    # Aggregate workflow runs into sequencing reads, deduping by sample id so a sample's
    # multiple CG runs collapse into one read with many consensusGenomes edges.
    def build_sequencing_reads(runs)
      result = []
      index_by_sample_id = {}

      runs.each do |run|
        sample = run["sample"] || {}
        info = sample["info"] || {}
        id = info["id"]&.to_s || ""
        edge = consensus_genome_edge(run)

        if index_by_sample_id.key?(id)
          result[index_by_sample_id[id]][:consensusGenomes][:edges] << edge
        else
          index_by_sample_id[id] = result.size
          result << build_sequencing_read(run, sample, info, id, edge)
        end
      end

      result
    end

    def build_sequencing_read(run, sample, info, id, edge)
      inputs = run["inputs"] || {}
      metadata = sample["metadata"]

      {
        id: id,
        nucleicAcid: metadata_value(metadata, "nucleotide_type") || "",
        protocol: inputs["wetlab_protocol"],
        medakaModel: inputs["medaka_model"],
        technology: inputs["technology"] || "",
        taxon: taxon_for(inputs),
        sample: build_sample(run, sample, info, metadata),
        consensusGenomes: { edges: [edge] },
      }
    end

    def build_sample(run, sample, info, metadata)
      {
        railsSampleId: info["id"],
        name: info["name"] || "",
        notes: info["sample_notes"],
        uploadError: info["result_status_description"],
        collectionLocation: collection_location(metadata),
        sampleType: metadata_value(metadata, "sample_type") || "",
        waterControl: metadata_value(metadata, "water_control") == "Yes",
        hostOrganism: info["host_genome_name"] ? { name: info["host_genome_name"] } : nil,
        collection: {
          name: sample["project_name"],
          # Federation: `public: Boolean(sampleInfo?.public)`. JS Boolean() treats 0 / "" / null /
          # false as falsy; Ruby treats 0 and "" as truthy, so a private project (public_access 0)
          # wrongly became `true`. Coerce with JS semantics to match exactly. (CZID-307 parity)
          public: ![nil, false, 0, 0.0, ""].include?(info["public"]),
        },
        ownerUserId: sample.dig("uploader", "id"),
        ownerUserName: run.dig("runner", "name") || sample.dig("uploader", "name"),
        metadatas: { edges: metadata_edges(metadata) },
      }
    end

    def consensus_genome_edge(run)
      inputs = run["inputs"] || {}
      quality_metrics = run.dig("cached_results", "quality_metrics") || {}
      coverage_viz = run.dig("cached_results", "coverage_viz") || {}
      accession = accession_for(inputs)

      {
        node: {
          producingRunId: run["id"]&.to_s,
          taxon: taxon_for(inputs),
          referenceGenome: accession,
          accession: accession,
          metrics: {
            coverageDepth: coverage_viz["coverage_depth"],
            totalReads: quality_metrics["total_reads"],
            gcPercent: quality_metrics["gc_percent"],
            refSnps: quality_metrics["ref_snps"],
            percentIdentity: quality_metrics["percent_identity"],
            nActg: quality_metrics["n_actg"],
            percentGenomeCalled: quality_metrics["percent_genome_called"],
            nMissing: quality_metrics["n_missing"],
            nAmbiguous: quality_metrics["n_ambiguous"],
            referenceGenomeLength: quality_metrics["reference_genome_length"],
          },
        },
      }
    end

    def taxon_for(inputs)
      inputs["taxon_name"] ? { name: inputs["taxon_name"] } : nil
    end

    def accession_for(inputs)
      return nil unless inputs["accession_id"] && inputs["accession_name"]

      { accessionId: inputs["accession_id"], accessionName: inputs["accession_name"] }
    end

    def collection_location(metadata)
      value = metadata_value(metadata, "collection_location_v2")
      return value if value.is_a?(String)

      (value.is_a?(Hash) ? value["name"] : nil) || ""
    end

    def metadata_value(metadata, key)
      metadata.is_a?(Hash) ? metadata[key] : nil
    end

    def metadata_edges(metadata)
      return [] unless metadata.is_a?(Hash)

      metadata.reject { |field_name, _| METADATA_EDGE_EXCLUSIONS.include?(field_name) }
              .map { |field_name, value| { node: { fieldName: field_name, value: value.to_s } } }
    end
  end
end

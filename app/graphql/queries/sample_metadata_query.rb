module Queries
  # Ported from the GraphQL federation server (resolver-functions/SampleMetadata) as
  # part of CZID-285. Serves the `SampleMetadata` query natively from Rails instead of
  # proxying GET /samples/:id/metadata. Mirrors SamplesController#metadata: select the
  # pipeline run, curate its display, and assemble the metadata + additional_info
  # payload, then apply the federation's post-processing (stringify ids; resolve the
  # location_validated_value union).
  #
  # snapshotLinkId is accepted for query parity but unused — the federation resolver
  # likewise built the non-snapshot /samples/:id/metadata URL and ignored it.
  module SampleMetadataQuery
    extend ActiveSupport::Concern
    include ReportHelper          # select_pipeline_run
    include PipelineOutputsHelper # curate_pipeline_run_display

    LOCATION_OBJECT_TYPENAME = Types::SampleMetadataLocationOneof1Type.graphql_name
    LOCATION_STRING_TYPENAME = Types::SampleMetadataLocationOneof0Type.graphql_name

    included do
      field :SampleMetadata,
            Types::SampleMetadataType,
            null: true,
            camelize: false,
            resolver_method: :resolve_sample_metadata do
        argument :sample_id, String, required: false
        argument :snapshot_link_id, String, required: false
        argument :input, Types::SampleMetadataInputType, required: false
      end
    end

    def resolve_sample_metadata(sample_id: nil, snapshot_link_id: nil, input: nil)
      current_power = context[:current_power]
      sample = current_power.viewable_samples.find(sample_id.to_i)

      pipeline_version = input&.pipeline_version
      pr = select_pipeline_run(sample, pipeline_version)

      editable = current_power.updatable_sample?(sample)
      pr_display = nil
      ercc_comparison = nil
      summary_stats = nil
      if pr
        pr_display = curate_pipeline_run_display(pr)
        ercc_comparison = pr.compare_ercc_counts
        job_stats_hash = job_stats_get(pr.id)
        summary_stats = get_summary_stats(job_stats_hash, pr) if job_stats_hash.present?
      end

      response = {
        metadata: sample.metadata_with_base_type,
        additional_info: {
          name: sample.name,
          editable: editable,
          host_genome_name: sample.host_genome_name,
          host_genome_taxa_category: sample.host_genome.taxa_category,
          # Federation passes the Rails REST JSON value, where ActiveSupport encodes Time as
          # ISO8601 with ms ("2026-06-24T15:45:04.000-07:00"). A bare Time serializes via #to_s
          # ("2026-06-24 15:45:04 -0700") instead, so match the wire format. (CZID-307 parity)
          upload_date: sample.created_at.as_json,
          project_name: sample.project.name,
          project_id: sample.project_id,
          notes: sample.sample_notes,
          ercc_comparison: ercc_comparison,
          pipeline_run: pr_display,
          summary_stats: summary_stats,
        },
      }

      apply_federation_transforms(response)
    end

    private

    # Reproduces the federation resolver's post-processing: deep-symbolize keys so the
    # graphql-ruby field readers (`object[:symbol]`) resolve, stringify the metadata and
    # pipeline_run ids, and tag each location_validated_value with the union member type.
    def apply_federation_transforms(response)
      response = response.deep_symbolize_keys

      response[:metadata] = Array(response[:metadata]).map do |item|
        item[:id] = item[:id].to_s unless item[:id].nil?
        item[:location_validated_value] = resolve_location_validated_value(item[:location_validated_value])
        item
      end

      pipeline_run = response.dig(:additional_info, :pipeline_run)
      if pipeline_run && !pipeline_run[:id].nil?
        pipeline_run[:id] = pipeline_run[:id].to_s
      end

      response
    end

    def resolve_location_validated_value(value)
      case value
      when Hash
        value.merge(
          id: value[:id].nil? ? nil : value[:id].to_s,
          __typename: LOCATION_OBJECT_TYPENAME
        )
      when String
        { name: value, __typename: LOCATION_STRING_TYPENAME }
      end
    end
  end
end

module Queries
  # Ported from the GraphQL federation server (resolver-functions/MetadataFields) as
  # part of CZID-285. Mirrors SamplesController#metadata_fields (both paths return
  # MetadataField#field_info hashes). snapshotLinkId is accepted for query parity but
  # unused -- the federation resolver also posted to the non-snapshot /samples/metadata_fields.
  module MetadataFieldsQuery
    extend ActiveSupport::Concern

    included do
      field :MetadataFields,
            [Types::MetadataFieldType],
            null: true,
            camelize: false,
            resolver_method: :resolve_metadata_fields do
        argument :snapshot_link_id, String, required: false
        argument :input, Types::MetadataFieldsInputType, required: false
      end
    end

    def resolve_metadata_fields(input:, snapshot_link_id: nil)
      current_power = context[:current_power]
      sample_ids = (input&.sample_ids || []).map(&:to_i)

      # Public snapshot-share viewer: authorize the requested ids against the SnapshotLink instead of
      # the empty current_power, and read the samples directly. by_samples needs a relation, so we
      # scope Sample by the authorized ids (SMP-1457). Session path is unchanged.
      if snapshot_link_id.present?
        authorized_ids = snapshot_authorized_sample_ids(sample_ids, snapshot_link_id)
        if sample_ids.length == 1
          Sample.find(authorized_ids.first).metadata_fields_info
        else
          MetadataField.by_samples(Sample.where(id: authorized_ids))
        end
      elsif sample_ids.length == 1
        sample = current_power.viewable_samples.find(sample_ids[0])
        sample.metadata_fields_info
      else
        samples = current_power.viewable_samples.where(id: sample_ids)
        MetadataField.by_samples(samples)
      end
    end
  end
end

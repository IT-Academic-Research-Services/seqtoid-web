module Mutations
  # Ported from the federation server (resolver-functions/UpdateMetadata) as part of
  # CZID-304. Serves `UpdateMetadata` natively instead of proxying
  # POST /samples/:id/save_metadata_v2 { field, value }. Mirrors
  # SamplesController#save_metadata_v2: scope to current_power.updatable_samples, call
  # Sample#metadatum_add_or_update with the field + value (a plain String or a location
  # object, exactly as the federation forwarded it), and map the model result to the
  # {status, message} contract.
  class UpdateMetadata < Mutations::BaseMutation
    graphql_name "UpdateMetadata"

    argument :sample_id, String, required: false
    argument :input, Types::UpdateMetadataInputType, required: false

    field :status, String, null: true
    field :message, String, null: true

    def resolve(input:, sample_id: nil)
      sample = context[:current_power].updatable_samples.find(sample_id.to_i)
      result = sample.metadatum_add_or_update(input.field, metadata_value(input.value))

      if result[:status] == "ok"
        { status: "success", message: "Saved successfully" }
      else
        { status: "failed", message: result[:error] }
      end
    end

    private

    # The federation took input.value.String when present, else the location object. The
    # location branch is passed through as a string-keyed hash (the shape
    # metadatum_add_or_update expects from the original REST params).
    def metadata_value(value_input)
      Rails.logger.debug("metadata_value: #{value_input&.inspect}")
      return value_input.string_value unless value_input.string_value.nil?

      location = value_input.location_value&.to_h&.deep_stringify_keys
      return nil unless location

      # If the location is a plain-text entry, just use the name.
      if location.keys.sort == ["name", "title"]
        location["name"]
      else
        location.to_json
      end
    end
  end
end

module Types
  class MetadataFieldsInputType < Types::BaseInputObject
    # CZID-305: must match the federation/frontend input type name exactly — the
    # SampleDetailsMode MetadataFields query declares
    # $input: queryInput_MetadataFields_input_Input.
    graphql_name "queryInput_MetadataFields_input_Input"

    # [String]! — non-null list, nullable inner — to match the federation input.
    argument :sample_ids, [String, { null: true }], required: true
    # Accepted for parity with the federation query; unused server-side.
    argument :authenticity_token, String, required: false
  end
end

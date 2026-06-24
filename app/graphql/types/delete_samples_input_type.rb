module Types
  # Federation mesh input `mutationInput_DeleteSamples_input_Input` (CZID-304).
  # idsStrings supersedes ids during the id-as-string migration (the resolver prefers it
  # when present). authenticityToken is accepted for parity but unused.
  class DeleteSamplesInputType < Types::BaseInputObject
    graphql_name "mutationInput_DeleteSamples_input_Input"

    argument :ids, [Int, { null: true }], required: false, camelize: false
    argument :ids_strings, [String, { null: true }], required: false
    argument :workflow, String, required: false, camelize: false
    argument :authenticity_token, String, required: false
  end
end

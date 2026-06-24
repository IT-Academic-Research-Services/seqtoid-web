module Types
  # Shared discovery filter leaf — `{ _in: [String] }`. The federation mesh emitted a
  # distinct generated type per use site; we reuse one input here since the 305 cutover
  # regenerates Relay artifacts from this schema (only the top-level fed* input type
  # names need to match the mesh, not these nested operator leaves). CZID-285.
  class StringListInFilterType < Types::BaseInputObject
    graphql_name "StringListInFilter"

    argument :_in, [String, { null: true }], required: false, camelize: false
  end
end

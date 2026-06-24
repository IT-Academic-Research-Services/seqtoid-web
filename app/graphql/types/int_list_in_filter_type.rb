module Types
  # Shared discovery filter leaf — `{ _in: [Int] }`. See StringListInFilterType for
  # why a shared input is used instead of the mesh's per-site generated types. CZID-285.
  class IntListInFilterType < Types::BaseInputObject
    graphql_name "IntListInFilter"

    argument :_in, [Int, { null: true }], required: false, camelize: false
  end
end

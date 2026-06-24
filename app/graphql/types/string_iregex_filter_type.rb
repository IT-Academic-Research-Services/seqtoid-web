module Types
  # Shared discovery filter leaf — `{ _iregex: String }` (case-insensitive search).
  # CZID-285.
  class StringIregexFilterType < Types::BaseInputObject
    graphql_name "StringIregexFilter"

    argument :_iregex, String, required: false, camelize: false
  end
end

module Types
  class MutationType < Types::BaseObject
    field :createUser, mutation: ::Mutations::CreateUser do
      argument :email, String, required: true
    end

    # CZID-304: fed* mutations ported to Rails-native GraphQL. camelize: false keeps the
    # exact federation field names (UpdateSampleName, not updateSampleName).
    field :UpdateSampleName, mutation: ::Mutations::UpdateSampleName, camelize: false
    field :UpdateSampleNotes, mutation: ::Mutations::UpdateSampleNotes, camelize: false
    field :UpdateMetadata, mutation: ::Mutations::UpdateMetadata, camelize: false
    field :DeleteSamples, mutation: ::Mutations::DeleteSamples, camelize: false
  end
end

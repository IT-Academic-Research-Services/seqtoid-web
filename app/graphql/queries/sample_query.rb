module Queries
  module SampleQuery
    extend ActiveSupport::Concern

    included do
      field :sample, Types::SampleType, null: false do
        argument :sampleId, Integer, required: true
      end
    end

    def sample(params)
      # Scope the lookup to samples the current user is allowed to view (own/editable projects,
      # public projects, or samples past their private-retention window) -- NOT a bare
      # Sample.find, which would let any logged-in user read any sample by id (SMP-1570 IDOR).
      # A sample the user cannot view raises RecordNotFound below, yielding the same "Sample not
      # found" the anonymous case gets -- no existence oracle.
      context[:current_power].viewable_samples.find(params[:sampleId])
    rescue ActiveRecord::RecordNotFound
      raise GraphQL::ExecutionError, "Sample not found"
    end
  end
end

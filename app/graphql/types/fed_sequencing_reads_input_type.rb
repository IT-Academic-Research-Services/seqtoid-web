module Types
  # Federation mesh input `queryInput_fedSequencingReads_input_Input` (CZID-285). Top
  # name matches the mesh; nested inputs are local. The resolver consumes todoRemove
  # (discovery filters) + limit/offset/limitOffset (pagination); where/orderBy are
  # modeled so the frontend input validates but are forwarded via todoRemove, mirroring
  # the federation resolver.
  class FedSequencingReadsInputType < Types::BaseInputObject
    graphql_name "queryInput_fedSequencingReads_input_Input"

    argument :limit, Int, required: false, camelize: false
    argument :offset, Int, required: false, camelize: false
    argument :limitOffset, Types::FedSequencingReadsLimitOffsetInputType, required: false, camelize: false
    argument :where, Types::FedSequencingReadsWhereInputType, required: false, camelize: false
    argument :orderByArray, [Types::FedSequencingReadsOrderByArrayItemInputType], required: false, camelize: false
    argument :consensusGenomesInput, Types::FedSequencingReadsConsensusGenomesInputType, required: false, camelize: false
    argument :todoRemove, Types::FedSequencingReadsTodoRemoveInputType, required: false, camelize: false
  end
end

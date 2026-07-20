# frozen_string_literal: true

require "rails_helper"

# Branch sweep for Queries::ValidateUserCanDeleteObjectsQuery#resolve_... (CZID-285). The
# existing spec is a request spec; this drives the resolver through doubles so the
# selected-ids fallback, the invalid-names gate, and the valid_ids nil-coalesce arms are
# each exercised in isolation.
#
# Branches driven (each fails if its arm is inverted/removed):
#   - selected_ids: selected_ids_strings present vs nil -> selected_ids fallback (||).
#   - invalid names: error.nil? && !invalid_sample_ids.empty? -> lookup vs skip
#     (error present OR no invalid ids).
#   - valid_ids_strings: (valid_ids || []).map -> nil valid_ids coalesced to [].
RSpec.describe Queries::ValidateUserCanDeleteObjectsQuery, type: :concern do
  # Host mixing in the concern. The `included do field ... end` needs a no-op `field` DSL;
  # the resolver reads context[:current_user] / [:current_power], stubbed per-example.
  let(:host_class) do
    Class.new do
      def self.field(*_args, **_kwargs); end
      include Queries::ValidateUserCanDeleteObjectsQuery
      attr_accessor :context
    end
  end

  let(:host) do
    h = host_class.new
    h.context = { current_user: double("user"), current_power: power }
    h
  end

  let(:power) { double("power") }

  def input_double(selected_ids_strings: nil, selected_ids: nil, workflow: "consensus-genome")
    double("input", selected_ids_strings: selected_ids_strings, selected_ids: selected_ids, workflow: workflow)
  end

  it "prefers selected_ids_strings, passing them to the validation service" do
    allow(DeletionValidationService).to receive(:call)
      .and_return(valid_ids: [1], invalid_sample_ids: [], error: nil)

    host.resolve_validate_user_can_delete_objects(input: input_double(selected_ids_strings: %w[1 2]))

    expect(DeletionValidationService).to have_received(:call)
      .with(hash_including(query_ids: %w[1 2]))
  end

  it "falls back to selected_ids when the strings variant is nil (the || arm)" do
    allow(DeletionValidationService).to receive(:call)
      .and_return(valid_ids: [1], invalid_sample_ids: [], error: nil)

    host.resolve_validate_user_can_delete_objects(input: input_double(selected_ids_strings: nil, selected_ids: [7, 8]))

    expect(DeletionValidationService).to have_received(:call)
      .with(hash_including(query_ids: [7, 8]))
  end

  it "looks up invalid sample names only when there is no error AND invalid ids exist" do
    allow(DeletionValidationService).to receive(:call)
      .and_return(valid_ids: [1], invalid_sample_ids: [9], error: nil)
    samples_scope = double("samples")
    allow(power).to receive(:samples).and_return(samples_scope)
    allow(samples_scope).to receive(:where).with(id: [9]).and_return(double("rel", pluck: ["Sample Nine"]))

    result = host.resolve_validate_user_can_delete_objects(input: input_double(selected_ids_strings: %w[1]))

    expect(result[:invalid_sample_names]).to eq(["Sample Nine"])
  end

  it "skips the name lookup when an error is present (gate false via error)" do
    allow(DeletionValidationService).to receive(:call)
      .and_return(valid_ids: nil, invalid_sample_ids: [9], error: "boom")
    expect(power).not_to receive(:samples)

    result = host.resolve_validate_user_can_delete_objects(input: input_double(selected_ids_strings: %w[1]))

    # error present -> no lookup; and valid_ids nil -> (valid_ids || []) coalesces to [].
    expect(result[:invalid_sample_names]).to eq([])
    expect(result[:valid_ids_strings]).to eq([])
    expect(result[:error]).to eq("boom")
  end

  it "skips the name lookup when there are no invalid ids (gate false via empty)" do
    allow(DeletionValidationService).to receive(:call)
      .and_return(valid_ids: [1, 2], invalid_sample_ids: [], error: nil)
    expect(power).not_to receive(:samples)

    result = host.resolve_validate_user_can_delete_objects(input: input_double(selected_ids_strings: %w[1 2]))

    expect(result[:invalid_sample_names]).to eq([])
    expect(result[:valid_ids_strings]).to eq(%w[1 2])
  end
end

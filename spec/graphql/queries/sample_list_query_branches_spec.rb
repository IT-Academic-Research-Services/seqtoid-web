# frozen_string_literal: true

require "rails_helper"

# Branch sweep for the Queries::SampleListQuery concern (CZID-285). The concern has no
# dedicated spec, so every conditional arm in samples_list is currently untaken.
#
# Branches driven here (each fails if the arm is inverted/removed):
#   - sorting_v0_allowed: admin-feature true; feature+my_data true; feature+other-domain
#     false; neither false (the || / && short-circuit arms).
#   - order_by: sorting allowed -> params["orderBy"] || "createdAt" (both arms); else :id.
#   - limit ternary: params[:limit] present -> to_i; absent -> nil-then-branch.
#   - limit nil-branch: projectId present -> nil (no cap); absent -> MAX_SAMPLES_LIMIT.
#   - limit present-branch: [MAX, limit].min cap.
#   - samples sort: sorting allowed -> Sample.sort_samples; else -> order(hash).
#   - limit.nil? guard: offset/limit applied only when a cap exists.
#   - offset: read from params[:offset] (0 default) and passed to samples.offset -- guards
#     the params[:offset] fix (was params[offset], a nil key that pinned offset to 0).
#   - basic gate: basic false -> visibility + details merge; basic true -> skipped.
#   - list_all_sample_ids gate: results[:sampleIds] added only when truthy.
RSpec.describe Queries::SampleListQuery, type: :concern do
  # Minimal host mixing in the concern. The concern reads context[:current_user] /
  # context[:current_power] and calls SamplesHelper methods -- the real helper is
  # mixed in (via the concern) and its methods are stubbed on the instance. The
  # `included do field ... end` block needs a `field` DSL method on the host; a no-op
  # class method that ignores its block satisfies it without graphql-ruby machinery.
  let(:host_class) do
    Class.new do
      def self.field(*_args, **_kwargs); end
      include Queries::SampleListQuery
      attr_accessor :context
    end
  end

  let(:current_power) { double("power") }
  let(:host) do
    h = host_class.new
    h.context = { current_user: current_user, current_power: current_power }
    h
  end

  # A chainable samples-relation spy. order/offset/limit/includes return self;
  # as_json returns a fixed list; map(&:id) via `map` yields nothing unless needed.
  def samples_spy(ids: [1])
    rel = double("samples")
    allow(rel).to receive(:order).and_return(rel)
    allow(rel).to receive(:offset).and_return(rel)
    allow(rel).to receive(:limit).and_return(rel)
    allow(rel).to receive(:includes).and_return(rel)
    allow(rel).to receive(:as_json).and_return([{ "id" => ids.first }])
    allow(rel).to receive(:map).and_return(ids)
    rel
  end

  # current_user with configurable feature flags; allowed_feature? drives sorting_v0.
  def user_with_features(features)
    u = double("user")
    allow(u).to receive(:allowed_feature?) { |f| features.include?(f) }
    u
  end

  # Wire up the SamplesHelper collaborators the method calls, returning a relation spy.
  def stub_helpers(rel)
    allow(host).to receive(:sanitize_order_dir).and_return(:desc)
    allow(host).to receive(:fetch_samples_with_current_power).and_return(rel)
    allow(host).to receive(:get_visibility_by_sample_id_and_current_power).and_return({})
    allow(host).to receive(:format_samples).and_return(rel)
    allow(Sample).to receive(:sort_samples).and_return(rel)
  end

  let(:current_user) { user_with_features([]) }

  describe "#samples_list sorting_v0_allowed" do
    it "sorts via Sample.sort_samples when the admin feature is on" do
      admin_user = user_with_features(["sorting_v0_admin"])
      host.context = { current_user: admin_user, current_power: current_power }
      rel = samples_spy
      stub_helpers(rel)

      host.samples_list({ "orderBy" => "name", basic: true, limit: 5 })

      # sorting allowed -> Sample.sort_samples called with the requested orderBy.
      expect(Sample).to have_received(:sort_samples).with(rel, "name", :desc)
    end

    it "is allowed when sorting_v0 feature is on AND domain == my_data" do
      user = user_with_features(["sorting_v0"])
      host.context = { current_user: user, current_power: current_power }
      rel = samples_spy
      stub_helpers(rel)

      host.samples_list({ domain: "my_data", basic: true, limit: 5 })

      expect(Sample).to have_received(:sort_samples)
    end

    it "is NOT allowed when sorting_v0 feature is on but domain != my_data (order(hash) arm)" do
      user = user_with_features(["sorting_v0"])
      host.context = { current_user: user, current_power: current_power }
      rel = samples_spy
      stub_helpers(rel)

      host.samples_list({ domain: "all_data", basic: true, limit: 5 })

      # not allowed -> falls to samples.order(id => dir); Sample.sort_samples untouched.
      expect(Sample).not_to have_received(:sort_samples)
      expect(rel).to have_received(:order).with(id: :desc)
    end

    it "is NOT allowed when no feature flags are set at all" do
      rel = samples_spy
      stub_helpers(rel)

      host.samples_list({ basic: true, limit: 5 })

      expect(Sample).not_to have_received(:sort_samples)
    end
  end

  describe "#samples_list order_by defaulting" do
    it "defaults orderBy to createdAt when sorting allowed but no orderBy given (|| arm)" do
      admin_user = user_with_features(["sorting_v0_admin"])
      host.context = { current_user: admin_user, current_power: current_power }
      rel = samples_spy
      stub_helpers(rel)

      host.samples_list({ basic: true, limit: 5 })

      expect(Sample).to have_received(:sort_samples).with(rel, "createdAt", :desc)
    end
  end

  describe "#samples_list limit resolution" do
    it "disables the limit (nil) when no limit given but a projectId is present" do
      rel = samples_spy
      stub_helpers(rel)

      host.samples_list({ basic: true, projectId: 9 })

      # limit nil -> the `unless limit.nil?` block is skipped, so offset/limit not applied.
      expect(rel).not_to have_received(:offset)
      expect(rel).not_to have_received(:limit)
    end

    it "caps at MAX_SAMPLES_LIMIT when no limit and no projectId" do
      rel = samples_spy
      stub_helpers(rel)

      host.samples_list({ basic: true })

      expect(rel).to have_received(:limit).with(Queries::SampleListQuery::MAX_SAMPLES_LIMIT)
    end

    it "caps a too-large explicit limit down to MAX_SAMPLES_LIMIT (the .min arm)" do
      rel = samples_spy
      stub_helpers(rel)

      host.samples_list({ basic: true, limit: 9999 })

      expect(rel).to have_received(:limit).with(Queries::SampleListQuery::MAX_SAMPLES_LIMIT)
    end

    it "honors an explicit limit below the cap" do
      rel = samples_spy
      stub_helpers(rel)

      host.samples_list({ basic: true, limit: 5 })

      expect(rel).to have_received(:limit).with(5)
    end

    it "applies the requested offset when a limit is in effect" do
      rel = samples_spy
      stub_helpers(rel)

      # offset is read from params[:offset]; with a limit present the
      # `unless limit.nil?` block runs samples.offset(offset).limit(limit).
      host.samples_list({ basic: true, limit: 5, offset: 20 })

      expect(rel).to have_received(:offset).with(20)
    end

    it "defaults the offset to 0 when none is given" do
      rel = samples_spy
      stub_helpers(rel)

      host.samples_list({ basic: true, limit: 5 })

      expect(rel).to have_received(:offset).with(0)
    end
  end

  describe "#samples_list basic gate + list_all_ids" do
    it "loads per-sample details/visibility when basic is falsey" do
      rel = samples_spy(ids: [3])
      stub_helpers(rel)

      host.samples_list({ limit: 5 })

      expect(host).to have_received(:format_samples).with(rel)
      expect(host).to have_received(:get_visibility_by_sample_id_and_current_power)
    end

    it "skips details/visibility when basic is true" do
      rel = samples_spy(ids: [3])
      stub_helpers(rel)

      host.samples_list({ basic: true, limit: 5 })

      expect(host).not_to have_received(:format_samples)
      expect(host).not_to have_received(:get_visibility_by_sample_id_and_current_power)
    end

    it "includes sampleIds in the result only when listAllIds is truthy" do
      rel = samples_spy(ids: [3])
      stub_helpers(rel)

      result = host.samples_list({ basic: true, limit: 5, listAllIds: true })

      expect(result).to have_key("sampleIds")
    end

    it "omits sampleIds when listAllIds is falsey" do
      rel = samples_spy(ids: [3])
      stub_helpers(rel)

      result = host.samples_list({ basic: true, limit: 5 })

      expect(result).not_to have_key("sampleIds")
    end
  end
end

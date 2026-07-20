# frozen_string_literal: true

require "rails_helper"

# Branch sweep for the Queries::FedWorkflowRunsAggregateQuery concern (CZID-285/303c). The
# existing spec is a request spec; these drive the aggregate builder + filter helper
# directly so the pagination/next arms and the present?-gated filter arms are exercised in
# isolation (no DB, no schema execution).
#
# Branches driven (each fails if its arm is inverted/removed):
#   - aggregate_sample_filters: td nil -> {}; present? select (kept vs dropped);
#     taxon_thresholds&.map / annotations&.map present vs nil (&.) arms.
#   - resolve: paginated_ids present -> include/exclude next guard; counts || {} nil arm.
RSpec.describe Queries::FedWorkflowRunsAggregateQuery, type: :concern do
  # Host mixing in the concern. The `included do field ... end` needs a no-op `field` DSL.
  # discovery_projects_scope / format_discovery_projects come from the ProjectsDiscovery
  # concern; with verify_partial_doubles on, the host class must actually define them
  # before we can stub them -- so ProjectsDiscovery is mixed in too (we only stub, never
  # call, its real methods).
  let(:host_class) do
    Class.new do
      def self.field(*_args, **_kwargs); end
      include ProjectsDiscovery
      include Queries::FedWorkflowRunsAggregateQuery
    end
  end

  let(:host) { host_class.new }

  describe "#aggregate_sample_filters" do
    it "returns an empty hash when td is nil" do
      expect(host.send(:aggregate_sample_filters, nil)).to eq({})
    end

    it "keeps only present values and maps threshold/annotation objects to hashes" do
      td = double(
        "td",
        host: [1],
        location_v2: nil,
        taxon: "",
        taxa_levels: ["species"],
        taxon_thresholds: [double("thr", to_h: { metric: "x" })],
        annotations: [double("ann", to_h: { name: "hit" })],
        time: nil,
        tissue: "blood",
        visibility: []
      )

      result = host.send(:aggregate_sample_filters, td)

      # present? drops nil / "" / [] but keeps non-empty values.
      expect(result.keys).to contain_exactly(:host, :taxaLevels, :taxonThresholds, :annotations, :tissue)
      expect(result[:taxonThresholds]).to eq([{ metric: "x" }])
      expect(result[:annotations]).to eq([{ name: "hit" }])
    end

    it "leaves threshold/annotation keys out when they are nil (the &. nil arms)" do
      td = double(
        "td",
        host: nil, location_v2: nil, taxon: nil, taxa_levels: nil,
        taxon_thresholds: nil, annotations: nil, time: nil, tissue: nil, visibility: nil
      )

      # Every value nil -> not present -> select drops all; the &.map short-circuits to nil.
      expect(host.send(:aggregate_sample_filters, td)).to eq({})
    end
  end

  describe "#resolve_fed_workflow_runs_aggregate pagination + counts" do
    def input_double(collection_ids: nil)
      where = collection_ids.nil? ? nil : double("where", collectionId: double("cid", _in: collection_ids))
      double("input", todoRemove: nil, where: where)
    end

    before do
      allow(host).to receive(:discovery_projects_scope).and_return(:scope)
    end

    it "emits three workflow rows per project and reads counts by workflow key" do
      allow(host).to receive(:format_discovery_projects).and_return(
        [{ "id" => 1, "sample_counts" => { "cg_runs_count" => 4, "mngs_runs_count" => 2, "amr_runs_count" => 0 } }]
      )

      result = host.send(:resolve_fed_workflow_runs_aggregate, input: input_double)

      expect(result[:aggregate].size).to eq(3)
      cg_row = result[:aggregate].find { |r| r[:groupBy][:workflowVersion][:workflow][:name] == "consensus-genome" }
      expect(cg_row[:count]).to eq(4)
      expect(cg_row[:groupBy][:collectionId]).to eq(1)
    end

    it "defaults missing sample_counts to an empty hash (nil-coalesce -> nil counts)" do
      allow(host).to receive(:format_discovery_projects).and_return([{ "id" => 1 }])

      result = host.send(:resolve_fed_workflow_runs_aggregate, input: input_double)

      expect(result[:aggregate].map { |r| r[:count] }).to all(be_nil)
    end

    it "skips projects not in the collectionId pagination set, and keeps those that are" do
      allow(host).to receive(:format_discovery_projects).and_return(
        [{ "id" => 1, "sample_counts" => {} }, { "id" => 2, "sample_counts" => {} }]
      )

      result = host.send(:resolve_fed_workflow_runs_aggregate, input: input_double(collection_ids: [2]))

      collection_ids = result[:aggregate].map { |r| r[:groupBy][:collectionId] }.uniq
      expect(collection_ids).to eq([2])
    end
  end
end

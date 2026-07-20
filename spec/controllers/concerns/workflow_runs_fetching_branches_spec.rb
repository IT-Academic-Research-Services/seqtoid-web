require "rails_helper"

# Branch sweep for the WorkflowRunsFetching concern (CZID-285). The concern has no
# dedicated spec, so every conditional arm in filter_workflow_runs / format_workflow_runs
# (basic mode) / paginate_workflow_runs / discovery_workflow_runs is currently untaken.
#
# These tests drive the pure branch logic through plain doubles / chainable relation
# spies (no DB) so each arm is exercised in isolation:
#   - filter_workflow_runs: filters-blank vs each of the id/time/workflow/taxon guards,
#     plus the "taxon present but workflow != consensus_genome" arm that skips by_taxon.
#   - format_workflow_runs: the empty-relation early return, the basic-mode sample shape,
#     and the consensus_genome inputs branch vs the non-CG (inputs stay {}) branch.
#   - discovery_workflow_runs: the sorting_v0_allowed gate (admin / feature+my_data /
#     neither), order_by defaulting, and the list_all_ids gate.
RSpec.describe WorkflowRunsFetching, type: :concern do
  # Minimal host that mixes in the concern. The collaborators the concern reads
  # (current_user / sanitize_order_dir / fetch_* helpers) are stubbed per-example.
  # The real host (WorkflowRunsController) includes BOTH concerns. verify_partial_doubles
  # is on, so the host class must actually define every method we stub -- including
  # sanitize_order_dir, which lives in ParameterSanitization, not WorkflowRunsFetching.
  let(:host_class) do
    Class.new do
      include ParameterSanitization
      include WorkflowRunsFetching
      attr_accessor :current_user, :current_power
    end
  end

  let(:host) { host_class.new }

  let(:cg_workflow) { WorkflowRun::WORKFLOW[:consensus_genome] }

  # A chainable relation spy: every scope method returns the same object so we can
  # assert which scopes were (and were not) applied.
  def relation_spy
    rel = double("workflow_runs_relation")
    allow(rel).to receive(:where).and_return(rel)
    allow(rel).to receive(:by_time).and_return(rel)
    allow(rel).to receive(:by_workflow).and_return(rel)
    allow(rel).to receive(:by_taxon).and_return(rel)
    rel
  end

  describe "#filter_workflow_runs" do
    it "returns the relation untouched when filters are blank (present? == false)" do
      rel = relation_spy
      result = host.filter_workflow_runs(workflow_runs: rel, filters: {})

      expect(result).to be(rel)
      expect(rel).not_to have_received(:where)
      expect(rel).not_to have_received(:by_time)
      expect(rel).not_to have_received(:by_workflow)
      expect(rel).not_to have_received(:by_taxon)
    end

    it "applies the workflowRunIds filter when present" do
      rel = relation_spy
      host.filter_workflow_runs(workflow_runs: rel, filters: { workflowRunIds: [1, 2] })

      expect(rel).to have_received(:where).with(id: [1, 2])
    end

    it "parses the time window and applies by_time when present" do
      rel = relation_spy
      host.filter_workflow_runs(workflow_runs: rel, filters: { time: ["2021-01-01", "2021-02-15"] })

      expect(rel).to have_received(:by_time).with(
        start_date: Date.parse("2021-01-01"),
        end_date: Date.parse("2021-02-15")
      )
    end

    it "applies by_workflow when a workflow is present" do
      rel = relation_spy
      host.filter_workflow_runs(workflow_runs: rel, filters: { workflow: cg_workflow })

      expect(rel).to have_received(:by_workflow).with(cg_workflow)
    end

    it "applies by_taxon only when the workflow is consensus_genome" do
      rel = relation_spy
      host.filter_workflow_runs(workflow_runs: rel, filters: { taxon: "555", workflow: cg_workflow })

      expect(rel).to have_received(:by_taxon).with("555")
    end

    it "skips by_taxon when a taxon is given but the workflow is NOT consensus_genome" do
      rel = relation_spy
      host.filter_workflow_runs(
        workflow_runs: rel,
        filters: { taxon: "555", workflow: WorkflowRun::WORKFLOW[:amr] }
      )

      expect(rel).to have_received(:by_workflow).with(WorkflowRun::WORKFLOW[:amr])
      expect(rel).not_to have_received(:by_taxon)
    end

    it "skips by_taxon when a taxon is given but no workflow accompanies it" do
      rel = relation_spy
      host.filter_workflow_runs(workflow_runs: rel, filters: { taxon: "555" })

      expect(rel).not_to have_received(:by_taxon)
    end
  end

  describe "#format_workflow_runs" do
    it "returns [] immediately for an empty relation" do
      empty_rel = double("empty_relation", empty?: true)
      expect(host.format_workflow_runs(workflow_runs: empty_rel, mode: "basic")).to eq([])
    end

    context "in basic mode (no sample info)" do
      let(:wr) do
        double(
          "workflow_run",
          id: 7,
          workflow: WorkflowRun::WORKFLOW[:amr],
          user: double("user", name: "Runner"),
          user_id: 3,
          wdl_version: "1.2.3",
          created_at: Time.zone.parse("2021-06-01T00:00:00Z"),
          status: WorkflowRun::STATUS[:succeeded],
          parsed_cached_results: { "foo" => 1 },
          sample_id: 99
        )
      end

      it "serializes only ids for the sample and leaves inputs empty for a non-CG run" do
        rel = double("relation", empty?: false)
        allow(rel).to receive(:includes).with(:user).and_return([wr])

        out = host.format_workflow_runs(workflow_runs: rel, mode: "basic")

        expect(out.length).to eq(1)
        formatted = out.first
        expect(formatted[:id]).to eq(7)
        expect(formatted[:workflow]).to eq(WorkflowRun::WORKFLOW[:amr])
        expect(formatted[:runner]).to eq(name: "Runner", id: 3)
        expect(formatted[:status]).to eq("COMPLETE")
        expect(formatted[:cached_results]).to eq("foo" => 1)
        # non-CG: the consensus_genome inputs branch is skipped, inputs stay {}
        expect(formatted[:inputs]).to eq({})
        # basic mode: sample carries only the id
        expect(formatted[:sample]).to eq(info: { id: 99 })
      end
    end

    context "in basic mode with a consensus_genome run (inputs branch)" do
      let(:cg_wr) do
        wr = double(
          "cg_workflow_run",
          id: 8,
          workflow: WorkflowRun::WORKFLOW[:consensus_genome],
          user: nil,
          user_id: nil,
          wdl_version: "2.0.0",
          created_at: Time.zone.parse("2021-06-02T00:00:00Z"),
          status: WorkflowRun::STATUS[:running],
          parsed_cached_results: nil,
          sample_id: 100
        )
        allow(wr).to receive(:get_input) { |k| k == "technology" ? "ONT" : "val-#{k}" }
        wr
      end

      it "populates the CG inputs hash and resolves the technology label" do
        rel = double("relation", empty?: false)
        allow(rel).to receive(:includes).with(:user).and_return([cg_wr])
        # TaxonLineage.where(...).order(...).last is DB-bound; stub it to a nil lineage.
        lineage_scope = double("lineage_scope")
        allow(lineage_scope).to receive(:order).and_return(double("ordered", last: nil))
        allow(TaxonLineage).to receive(:where).and_return(lineage_scope)

        out = host.format_workflow_runs(workflow_runs: rel, mode: "basic")
        inputs = out.first[:inputs]

        # runner tolerates a nil user (safe-navigation branch)
        expect(out.first[:runner]).to eq(name: nil, id: nil)
        expect(inputs["accession_id"]).to eq("val-accession_id")
        expect(inputs).to have_key("taxon_name")
        # ONT -> ConsensusGenomeWorkflowRun::TECHNOLOGY_NAME lookup, capitalized
        expect(inputs).to have_key(:technology)
      end
    end
  end

  describe "#paginate_workflow_runs" do
    it "applies offset then limit to the relation" do
      offset_rel = double("offset_rel")
      final_rel = double("final_rel")
      rel = double("relation")
      allow(rel).to receive(:offset).with(5).and_return(offset_rel)
      allow(offset_rel).to receive(:limit).with(10).and_return(final_rel)

      expect(host.paginate_workflow_runs(workflow_runs: rel, offset: 5, limit: 10)).to be(final_rel)
    end
  end

  describe "#discovery_workflow_runs" do
    # Stub the fetch/sort/format collaborators so only the ordering + list_all_ids
    # branch logic under test is exercised.
    let(:fetched) { double("fetched_runs") }
    let(:sorted) { double("sorted_runs") }
    let(:paginated) { double("paginated_runs") }

    before do
      allow(host).to receive(:fetch_workflow_runs).and_return(fetched)
      allow(host).to receive(:sanitize_order_dir).and_return(:desc)
      allow(host).to receive(:paginate_workflow_runs).and_return(paginated)
      allow(host).to receive(:format_workflow_runs).and_return([{ id: 1 }])
    end

    it "uses sort_workflow_runs and defaults order_by to createdAt when sorting_v0 is admin-allowed" do
      host.current_user = double("user")
      allow(host.current_user).to receive(:allowed_feature?).with("sorting_v0_admin").and_return(true)

      expect(WorkflowRun).to receive(:sort_workflow_runs).with(fetched, "createdAt", :desc).and_return(sorted)

      result = host.discovery_workflow_runs(
        domain: "all_data", filters: {}, mode: "basic",
        order_by: nil, order_dir: "desc", offset: 0, limit: 10
      )

      expect(result[:workflow_runs]).to eq([{ id: 1 }])
      expect(result).not_to have_key(:all_workflow_run_ids)
    end

    it "grants sorting_v0 only in the my_data domain and honors an explicit order_by" do
      host.current_user = double("user")
      allow(host.current_user).to receive(:allowed_feature?).with("sorting_v0_admin").and_return(false)
      allow(host.current_user).to receive(:allowed_feature?).with("sorting_v0").and_return(true)

      expect(WorkflowRun).to receive(:sort_workflow_runs).with(fetched, "name", :desc).and_return(sorted)

      host.discovery_workflow_runs(
        domain: "my_data", filters: {}, mode: "basic",
        order_by: "name", order_dir: "desc", offset: 0, limit: 10
      )
    end

    it "falls back to a plain id order (no sort_workflow_runs) when sorting_v0 is not allowed" do
      host.current_user = double("user")
      allow(host.current_user).to receive(:allowed_feature?).and_return(false)
      allow(fetched).to receive(:order).with(Hash[id: :desc]).and_return(sorted)

      expect(WorkflowRun).not_to receive(:sort_workflow_runs)

      host.discovery_workflow_runs(
        domain: "all_data", filters: {}, mode: "basic",
        order_by: "ignored", order_dir: "desc", offset: 0, limit: 10
      )

      expect(fetched).to have_received(:order).with(Hash[id: :desc])
    end

    it "includes all_workflow_run_ids only when list_all_ids is requested" do
      host.current_user = double("user")
      allow(host.current_user).to receive(:allowed_feature?).and_return(false)
      allow(fetched).to receive(:order).and_return(sorted)
      allow(sorted).to receive(:pluck).with(:id).and_return([1, 2, 3])

      result = host.discovery_workflow_runs(
        domain: "all_data", filters: {}, mode: "basic",
        order_by: nil, order_dir: "desc", offset: 0, limit: 10, list_all_ids: true
      )

      expect(result[:all_workflow_run_ids]).to eq([1, 2, 3])
    end
  end
end

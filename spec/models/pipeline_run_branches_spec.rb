require 'rails_helper'

# Coverage Wave (branch): pipeline_run_spec.rb exercises the job-status/monitor
# machinery but leaves several small, pure-in-memory predicate/helper branches
# undriven. This spec drives ONLY those branches (no DB writes, no AWS) so each
# arm is hit and each test fails if its branch is inverted or removed:
#   - #workflow: technology == illumina (true arm) vs the else (long-read) arm
#   - #parse_dag_vars: the `dag_vars || "{}"` present-vs-nil operand
#   - #results_finalized?: include? true (each member) vs false
#   - #ready_for_cache?: both && operands, each side true and false
#   - #failed?: the `=~ || ==` disjunction, each operand independently
#   - #invalid_family_call?: below-threshold true, at/above false, and the rescue arm
#   - #output_state_hash: the `hash[id] || []` present-vs-missing operand
#   - #check_box_label: the `sample.project ? : ` ternary, both arms
#   - #status_display: the `if known_user_error` early return vs the helper arm
RSpec.describe PipelineRun, type: :model do
  describe "#workflow" do
    it "is short-read mNGS when technology is Illumina (true arm)" do
      pr = PipelineRun.new(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      expect(pr.workflow).to eq(WorkflowRun::WORKFLOW[:short_read_mngs])
    end

    it "is long-read mNGS for any non-Illumina technology (else arm)" do
      pr = PipelineRun.new(technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      expect(pr.workflow).to eq(WorkflowRun::WORKFLOW[:long_read_mngs])
    end
  end

  describe "#parse_dag_vars" do
    it "parses the JSON when dag_vars is present (first operand)" do
      pr = PipelineRun.new(dag_vars: '{"a":1}')
      expect(pr.parse_dag_vars).to eq({ "a" => 1 })
    end

    it "falls back to an empty object when dag_vars is nil (|| operand)" do
      pr = PipelineRun.new(dag_vars: nil)
      expect(pr.parse_dag_vars).to eq({})
    end
  end

  describe "#results_finalized?" do
    it "is true for FINALIZED_SUCCESS (first include member)" do
      pr = PipelineRun.new(results_finalized: PipelineRun::FINALIZED_SUCCESS)
      expect(pr.results_finalized?).to eq(true)
    end

    it "is true for FINALIZED_FAIL (second include member)" do
      pr = PipelineRun.new(results_finalized: PipelineRun::FINALIZED_FAIL)
      expect(pr.results_finalized?).to eq(true)
    end

    it "is false for an in-progress (non-terminal) value" do
      pr = PipelineRun.new(results_finalized: 0)
      expect(pr.results_finalized?).to eq(false)
    end
  end

  describe "#ready_for_cache?" do
    it "is true only when results succeeded AND job is CHECKED (both operands true)" do
      pr = PipelineRun.new(results_finalized: PipelineRun::FINALIZED_SUCCESS, job_status: PipelineRun::STATUS_CHECKED)
      expect(pr.ready_for_cache?).to eq(true)
    end

    it "is false when results are not FINALIZED_SUCCESS (first operand false)" do
      pr = PipelineRun.new(results_finalized: PipelineRun::FINALIZED_FAIL, job_status: PipelineRun::STATUS_CHECKED)
      expect(pr.ready_for_cache?).to eq(false)
    end

    it "is false when the job is not CHECKED (second operand false)" do
      pr = PipelineRun.new(results_finalized: PipelineRun::FINALIZED_SUCCESS, job_status: "1.RUNNING")
      expect(pr.ready_for_cache?).to eq(false)
    end
  end

  describe "#failed?" do
    it "is truthy when job_status matches /FAILED/ (first disjunct)" do
      pr = PipelineRun.new(job_status: "3.HostFiltering-FAILED", results_finalized: 0)
      expect(pr.failed?).to be_truthy
    end

    it "is truthy when results_finalized is FINALIZED_FAIL even if job_status does not match (second disjunct)" do
      pr = PipelineRun.new(job_status: "CHECKED", results_finalized: PipelineRun::FINALIZED_FAIL)
      expect(pr.failed?).to be_truthy
    end

    it "is falsey when neither disjunct holds" do
      pr = PipelineRun.new(job_status: "CHECKED", results_finalized: PipelineRun::FINALIZED_SUCCESS)
      expect(pr.failed?).to be_falsey
    end
  end

  describe "#invalid_family_call?" do
    it "is true when family_taxid is below the invalid-call base id (comparison true arm)" do
      pr = PipelineRun.new
      tcnt = { "family_taxid" => TaxonLineage::INVALID_CALL_BASE_ID - 1 }
      expect(pr.invalid_family_call?(tcnt)).to eq(true)
    end

    it "is false when family_taxid is a normal positive taxid (comparison false arm)" do
      pr = PipelineRun.new
      expect(pr.invalid_family_call?({ "family_taxid" => "9606" })).to eq(false)
    end

    it "is false (fail-safe) when the argument raises on lookup (rescue arm)" do
      pr = PipelineRun.new
      expect(pr.invalid_family_call?(nil)).to eq(false)
    end
  end

  describe "#output_state_hash" do
    it "maps output->state from the per-run entry when present (first operand)" do
      pr = PipelineRun.new
      allow(pr).to receive(:id).and_return(42)
      states = [double("os", output: "taxon_counts", state: "LOADED"),
                double("os", output: "contigs", state: "FAILED")]
      result = pr.output_state_hash({ 42 => states })
      expect(result).to eq({ "taxon_counts" => "LOADED", "contigs" => "FAILED" })
    end

    it "returns an empty hash when there is no entry for this run (|| [] operand)" do
      pr = PipelineRun.new
      allow(pr).to receive(:id).and_return(42)
      expect(pr.output_state_hash({ 99 => [double("os", output: "x", state: "y")] })).to eq({})
    end
  end

  describe "#check_box_label" do
    it "uses the project name when the sample has a project (ternary true arm)" do
      pr = PipelineRun.new
      allow(pr).to receive(:id).and_return(7)
      sample = double("sample", project: double("project", name: "My Project"), name: "SampleA")
      allow(pr).to receive(:sample).and_return(sample)
      expect(pr.check_box_label).to eq("My Project : SampleA (7)")
    end

    it "uses 'Unknown Project' when the sample has no project (ternary false arm)" do
      pr = PipelineRun.new
      allow(pr).to receive(:id).and_return(7)
      sample = double("sample", project: nil, name: "SampleA")
      allow(pr).to receive(:sample).and_return(sample)
      expect(pr.check_box_label).to eq("Unknown Project : SampleA (7)")
    end
  end

  describe "#status_display" do
    it "short-circuits to COMPLETE - ISSUE when there is a known user error (guard true arm)" do
      pr = PipelineRun.new(known_user_error: "InsufficientReadsError")
      expect(pr.status_display({})).to eq("COMPLETE - ISSUE")
    end

    it "delegates to the status_display helper when there is no known user error (guard false arm)" do
      pr = PipelineRun.new(known_user_error: nil)
      allow(pr).to receive(:status_display_helper).and_return("RUNNING")
      expect(pr.status_display({})).to eq("RUNNING")
    end
  end
end

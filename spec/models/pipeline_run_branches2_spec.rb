# frozen_string_literal: true

require 'rails_helper'

# Coverage Wave (branch): third branch sweep for PipelineRun, complementing
# pipeline_run_branches_spec.rb and pipeline_run_branch_paths_spec.rb. Those two
# focus on the S3 path builders and the stats loaders; this file drives the
# remaining pure predicates, guards and small state machines down BOTH arms:
#
#   - workflow (illumina / nanopore), parse_dag_vars (nil / set)
#   - check_box_label (project present / absent)
#   - create_output_states target selection (technology blank / present)
#   - completed? (finalized / legacy no-stages FAILED / neither)
#   - active_stage (a non-succeeded stage / all succeeded)
#   - retry (not-failed early return; failed reset, with a LOADED output left alone)
#   - ercc_output_path and host_count_s3_path across the host-filtering versions
#   - write_contig_mapping_table_csv (no contigs early return, Illumina vs ONT
#     base_count column, lineage present / absent)
#   - s3_file_for missing-pipeline_version warning (both operands of the guard)
#   - status_display known_user_error guard
#   - sfn_error / sfn_pipeline_error / cleanup_s3 guards
#   - major_minor / after / multihit? / assembly? / supports_assembly?
#   - get_contigs_for_taxid (NT / NR / merged fall-through)
#   - compare_ercc_counts (no counts / a matching count / a missing count)
#   - outputs_by_step + sfn_outputs_by_step case arms including the unmatched one
#   - check_and_log_long_run (already alerted / under threshold / over threshold)
#   - job_status_display (no status / stage-shaped status / opaque status)
#   - time_since_executed_at (executed_at set / nil)
#   - input_error (an INPUT_ERRORS match and a non-match)
RSpec.describe PipelineRun, type: :model do
  let(:project) { create(:project) }
  let(:sample) { create(:sample, project: project) }

  # Every example that touches destroy-adjacent or S3-adjacent code stubs the
  # boundary; nothing here reaches the network.
  before do
    allow(S3Util).to receive(:delete_s3_prefix)
  end

  describe "#workflow" do
    it "is short-read mngs for an Illumina run (the if-arm)" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      expect(pr.workflow).to eq(WorkflowRun::WORKFLOW[:short_read_mngs])
    end

    it "is long-read mngs for a nanopore run (the else-arm)" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      expect(pr.workflow).to eq(WorkflowRun::WORKFLOW[:long_read_mngs])
    end
  end

  describe "#parse_dag_vars" do
    it "falls back to an empty hash when dag_vars is nil (the || else-arm)" do
      expect(create(:pipeline_run, sample: sample, dag_vars: nil).parse_dag_vars).to eq({})
    end

    it "parses the stored json when dag_vars is set (the || then-arm)" do
      pr = create(:pipeline_run, sample: sample, dag_vars: '{"a":1}')
      expect(pr.parse_dag_vars).to eq("a" => 1)
    end
  end

  describe "#check_box_label" do
    it "uses the project name when the sample has a project (the ternary then-arm)" do
      pr = create(:pipeline_run, sample: sample)
      expect(pr.check_box_label).to eq("#{project.name} : #{sample.name} (#{pr.id})")
    end

    it "falls back to 'Unknown Project' when there is no project (the else-arm)" do
      pr = create(:pipeline_run, sample: sample)
      allow(pr.sample).to receive(:project).and_return(nil)

      expect(pr.check_box_label).to eq("Unknown Project : #{sample.name} (#{pr.id})")
    end
  end

  describe "#create_output_states" do
    it "uses the illumina target outputs when technology is blank (the ternary then-arm)" do
      # technology is NOT NULL with a presence validation, so the blank case is a
      # legacy row: write it past validation and re-derive the output states.
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      pr.update_column(:technology, "") # rubocop:disable Rails/SkipsModelValidations
      pr.output_states.destroy_all

      pr.reload.create_output_states

      expect(pr.reload.output_states.pluck(:output))
        .to match_array(PipelineRun::TARGET_OUTPUTS[PipelineRun::TECHNOLOGY_INPUT[:illumina]])
    end

    it "uses the technology-specific target outputs when set (the else-arm)" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])

      expect(pr.output_states.pluck(:output))
        .to match_array(PipelineRun::TARGET_OUTPUTS[PipelineRun::TECHNOLOGY_INPUT[:nanopore]])
    end
  end

  describe "#completed?" do
    it "is true as soon as the run is finalized (the first guard)" do
      pr = create(:pipeline_run, sample: sample, finalized: 1)
      expect(pr.completed?).to be(true)
    end

    it "is true for a legacy stage-less run in a terminal job status (the second guard)" do
      pr = create(:pipeline_run, sample: sample, finalized: 0, job_status: PipelineRun::STATUS_FAILED)
      pr.pipeline_run_stages.destroy_all

      expect(pr.reload.completed?).to be(true)
    end

    it "is falsy while an unfinalized run still has stages (both guards untaken)" do
      pr = create(:pipeline_run, sample: sample, finalized: 0, job_status: PipelineRun::STATUS_FAILED)

      expect(pr.pipeline_run_stages).not_to be_empty
      expect(pr.completed?).to be_falsey
    end
  end

  describe "#active_stage" do
    it "returns the first stage that has not succeeded (the unless then-arm)" do
      pr = create(:pipeline_run, sample: sample)
      first = pr.pipeline_run_stages.order(:step_number).first
      first.update!(job_status: PipelineRunStage::STATUS_STARTED)

      expect(pr.reload.active_stage).to eq(first)
    end

    it "returns nil once every stage has succeeded (the loop falls through)" do
      pr = create(:pipeline_run, sample: sample)
      pr.pipeline_run_stages.each { |prs| prs.update!(job_status: PipelineRunStage::STATUS_SUCCEEDED) }

      expect(pr.reload.active_stage).to be_nil
    end
  end

  describe "#retry" do
    it "does nothing when the run has not failed (the unless then-arm)" do
      pr = create(:pipeline_run, sample: sample, job_status: PipelineRun::STATUS_CHECKED, finalized: 1)

      expect(pr.retry).to be_nil
      expect(pr.reload.finalized).to eq(1)
    end

    it "reopens the run and resets non-loaded outputs when it has failed (the else-arm)" do
      pr = create(:pipeline_run, sample: sample, job_status: PipelineRun::STATUS_FAILED, finalized: 1)
      stage = pr.pipeline_run_stages.order(:step_number).first
      stage.update!(job_status: PipelineRun::STATUS_FAILED, db_load_status: 1)

      outputs = pr.output_states.order(:id)
      loaded = outputs.first
      unloaded = outputs.last
      loaded.update!(state: PipelineRun::STATUS_LOADED)
      unloaded.update!(state: PipelineRun::STATUS_LOADING_ERROR)

      pr.reload.retry

      expect(pr.reload.finalized).to eq(0)
      expect(pr.results_finalized).to eq(PipelineRun::IN_PROGRESS)
      # The LOADED output is left alone (the inner `if` else-arm); the other is reset.
      expect(loaded.reload.state).to eq(PipelineRun::STATUS_LOADED)
      expect(unloaded.reload.state).to eq(PipelineRun::STATUS_UNKNOWN)
      expect(stage.reload.job_status).to be_nil
    end
  end

  describe "#ercc_output_path" do
    it "uses the bowtie2 ercc file on >= 8.1 (both if-arms taken)" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "8.1")
      expect(pr.ercc_output_path).to eq(PipelineRun::BOWTIE2_ERCC_OUTPUT_NAME)
    end

    it "uses the kallisto ercc file on the new host-filtering stage below 8.1 (the inner else)" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "8.0")
      expect(pr.ercc_output_path).to eq(PipelineRun::KALLISTO_ERCC_OUTPUT_NAME)
    end

    it "uses the legacy ercc file on the old host-filtering stage (the outer else)" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "7.1")
      expect(pr.ercc_output_path).to eq(PipelineRun::ERCC_OUTPUT_NAME)
    end
  end

  describe "#host_count_s3_path" do
    it "points at the host transcript reads file on the new host-filtering stage (the if-arm)" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "8.0")
      allow(pr).to receive(:host_filter_output_s3_path).and_return("s3://bucket/hf")

      expect(pr.host_count_s3_path).to eq("s3://bucket/hf/#{PipelineRun::HOST_TRANSCRIPT_READS_OUTPUT_NAME}")
    end

    it "points at the STAR reads-per-gene file on the old stage (the else-arm)" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "7.0")
      allow(pr).to receive(:host_filter_output_s3_path).and_return("s3://bucket/hf")

      expect(pr.host_count_s3_path).to eq("s3://bucket/hf/#{PipelineRun::READS_PER_GENE_STAR_TAB_NAME}")
    end
  end

  describe "#write_contig_mapping_table_csv" do
    def stub_m8(pr, mapping = {})
      allow(pr).to receive(:get_m8_mapping).and_return(mapping)
    end

    it "writes nothing when there are no contigs (the early return)" do
      pr = create(:pipeline_run, sample: sample)
      buffer = []

      expect(pr.write_contig_mapping_table_csv(buffer)).to be_nil
      expect(buffer).to be_empty
    end

    it "omits the base_count column for an Illumina run (both technology if else-arms)" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      create(:contig, pipeline_run: pr, name: "NODE_1_length_500_cov_10", read_count: 7, lineage_json: "{}")
      stub_m8(pr)
      buffer = []

      pr.reload.write_contig_mapping_table_csv(buffer)

      expect(buffer.first[0, 4]).to eq(['contig_name', 'read_count', 'contig_length', 'contig_coverage'])
      expect(buffer.length).to eq(2)
      # name, read_count, then the two fields parsed out of the contig name.
      expect(buffer.last[0, 4]).to eq(["NODE_1_length_500_cov_10", 7, "500", "10"])
    end

    it "includes the base_count column for an ONT run (both technology if then-arms)" do
      pr = create(:pipeline_run, sample: sample, technology: "ONT")
      create(:contig, pipeline_run: pr, name: "NODE_2_length_900_cov_3", read_count: 4,
                      base_count: 4200, lineage_json: { "NT" => [11], "NR" => [22] }.to_json)
      stub_m8(pr)
      buffer = []

      pr.reload.write_contig_mapping_table_csv(buffer)

      expect(buffer.first[0, 5]).to eq(['contig_name', 'read_count', 'base_count', 'contig_length', 'contig_coverage'])
      expect(buffer.last[0, 5]).to eq(["NODE_2_length_900_cov_3", 4, 4200, "900", "3"])
      # The stored lineage is used instead of the null array (the `||` then-arm).
      expect(buffer.last).to include(11)
      expect(buffer.last).to include(22)
    end
  end

  describe "#s3_file_for missing-version guard" do
    it "logs when there is no pipeline_version and no finalized flag (the unless then-arm)" do
      # `finalized` is an integer column, and 0 is truthy in Ruby, so the guard can
      # only fire on a record whose finalized attribute is genuinely nil -- an
      # in-memory run that has not been persisted yet.
      pr = build(:pipeline_run, sample: sample, pipeline_version: nil, finalized: nil)

      expect(LogUtil).to receive(:log_error).with(/without a pipeline_version/, hash_including(:pipeline_run_id))

      pr.s3_file_for("contigs")
    end

    it "stays quiet for a finalized run with no version (the second operand)" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: nil, finalized: 1)

      expect(LogUtil).not_to receive(:log_error)

      pr.s3_file_for("contigs")
    end

    it "stays quiet when a version is present (the first operand)" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "6.8", finalized: 0)

      expect(LogUtil).not_to receive(:log_error)

      pr.s3_file_for("contigs")
    end
  end

  describe "#status_display" do
    it "short-circuits on a known user error (the guard then-arm)" do
      pr = create(:pipeline_run, sample: sample, known_user_error: "FAULTY_INPUT")

      expect(pr.status_display({})).to eq("COMPLETE - ISSUE")
    end

    it "delegates to the status helper otherwise (the else-arm)" do
      pr = create(:pipeline_run, sample: sample, known_user_error: nil)
      allow(pr).to receive(:status_display_helper).and_return("RUNNING")

      expect(pr.status_display({})).to eq("RUNNING")
    end
  end

  describe "sfn output path guards" do
    let(:pr) { create(:pipeline_run, sample: sample) }

    it "returns nil from sfn_error / sfn_pipeline_error when there is no output path (the guards)" do
      allow(pr).to receive(:sfn_output_path).and_return(nil)
      expect(SfnExecution).not_to receive(:new)

      expect(pr.sfn_error).to be_nil
      expect(pr.sfn_pipeline_error).to be_nil
    end

    it "asks SfnExecution when an output path exists (the else-arms)" do
      allow(pr).to receive(:sfn_output_path).and_return("s3://bucket/out")
      execution = instance_double(SfnExecution, error: "BOOM", pipeline_error: ["BOOM", "it broke"])
      allow(SfnExecution).to receive(:new).and_return(execution)

      expect(pr.sfn_error).to eq("BOOM")
      expect(pr.sfn_pipeline_error).to eq(["BOOM", "it broke"])
    end

    it "skips the S3 cleanup when the output path is blank (the guard then-arm)" do
      allow(pr).to receive(:sfn_output_path).and_return("")
      expect(S3Util).not_to receive(:delete_s3_prefix)

      expect(pr.cleanup_s3).to be_nil
    end

    it "deletes the prefix when the output path is present (the else-arm)" do
      allow(pr).to receive(:sfn_output_path).and_return("s3://bucket/out")
      expect(S3Util).to receive(:delete_s3_prefix).with("s3://bucket/out")

      pr.cleanup_s3
    end
  end

  describe "version comparison helpers" do
    let(:pr) { create(:pipeline_run, sample: sample) }

    it "treats a nil ceiling as always-after and a nil version as never-after (both guards)" do
      expect(pr.after("1.0", nil)).to be(true)
      expect(pr.after(nil, "1.0")).to be(false)
    end

    it "compares major then minor (each early return plus the final comparison)" do
      expect(pr.after("2.0", "1.5")).to be(true)
      expect(pr.after("1.0", "1.5")).to be(false)
      expect(pr.after("1.6", "1.5")).to be(true)
      expect(pr.after("1.4", "1.5")).to be(false)
      expect(pr.after("1.5", "1.5")).to be(true)
    end

    it "is multihit for nanopore without consulting the version (the || then-arm)" do
      nanopore = create(:pipeline_run, sample: sample,
                                       technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore],
                                       pipeline_version: "1.0")
      expect(nanopore.multihit?).to be(true)
    end

    it "falls through to the version comparison for Illumina (the || else-arm)" do
      old_run = create(:pipeline_run, sample: sample,
                                      technology: PipelineRun::TECHNOLOGY_INPUT[:illumina],
                                      pipeline_version: "1.4")
      new_run = create(:pipeline_run, sample: sample,
                                      technology: PipelineRun::TECHNOLOGY_INPUT[:illumina],
                                      pipeline_version: "1.6")

      expect(old_run.multihit?).to be(false)
      expect(new_run.multihit?).to be(true)
    end

    it "is never in assembly? mode for a realistic version" do
      expect(create(:pipeline_run, sample: sample, pipeline_version: "8.0").assembly?).to be(false)
    end

    it "supports assembly for nanopore and for Illumina >= 3.1 only" do
      nanopore = create(:pipeline_run, sample: sample,
                                       technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore],
                                       pipeline_version: "1.0")
      modern = create(:pipeline_run, sample: sample,
                                     technology: PipelineRun::TECHNOLOGY_INPUT[:illumina],
                                     pipeline_version: "3.1")
      ancient = create(:pipeline_run, sample: sample,
                                      technology: PipelineRun::TECHNOLOGY_INPUT[:illumina],
                                      pipeline_version: "3.0")

      expect(nanopore.send(:supports_assembly?)).to be(true)
      expect(modern.send(:supports_assembly?)).to be(true)
      expect(ancient.send(:supports_assembly?)).to be(false)
    end
  end

  describe "#get_contigs_for_taxid" do
    let(:pr) { create(:pipeline_run, sample: sample) }

    before do
      create(:contig, pipeline_run: pr, name: "nt_only", read_count: 9,
                      lineage_json: { "NT" => [100], "NR" => [] }.to_json)
      create(:contig, pipeline_run: pr, name: "nr_only", read_count: 5,
                      lineage_json: { "NT" => [], "NR" => [200] }.to_json)
    end

    it "matches only the NT lineage when db is NT (the first if-arm)" do
      expect(pr.reload.get_contigs_for_taxid(100, "NT").pluck(:name)).to eq(["nt_only"])
      expect(pr.reload.get_contigs_for_taxid(200, "NT")).to be_empty
    end

    it "matches only the NR lineage when db is NR (the elsif-arm)" do
      expect(pr.reload.get_contigs_for_taxid(200, "NR").pluck(:name)).to eq(["nr_only"])
      expect(pr.reload.get_contigs_for_taxid(100, "NR")).to be_empty
    end

    it "searches every lineage on the default db (the final elsif-arm)" do
      expect(pr.reload.get_contigs_for_taxid(100).pluck(:name)).to eq(["nt_only"])
      expect(pr.reload.get_contigs_for_taxid(200).pluck(:name)).to eq(["nr_only"])
      expect(pr.reload.get_contigs_for_taxid(999)).to be_empty
    end
  end

  describe "#compare_ercc_counts" do
    let(:pr) { create(:pipeline_run, sample: sample) }

    it "returns nil when the run has no ERCC counts (the guard then-arm)" do
      expect(pr.compare_ercc_counts).to be_nil
    end

    it "reports the stored count for a matched baseline and 0 otherwise (both || arms)" do
      first_baseline = ErccCount::BASELINE.first
      ErccCount.create!(pipeline_run: pr, name: first_baseline[:ercc_id], count: 42)

      result = pr.reload.compare_ercc_counts

      expect(result.length).to eq(ErccCount::BASELINE.length)
      matched = result.find { |row| row[:name] == first_baseline[:ercc_id] }
      expect(matched[:actual]).to eq(42)
      expect(result.reject { |row| row[:name] == first_baseline[:ercc_id] }.pluck(:actual).uniq).to eq([0])
    end
  end

  describe "#outputs_by_step / #sfn_outputs_by_step" do
    it "routes a step-function run to the SFN implementation (the if-arm)" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      allow(pr).to receive(:illumina_sfn_outputs_by_step).with(true).and_return("illumina" => {})

      expect(pr.outputs_by_step).to eq("illumina" => {})
    end

    it "routes a nanopore step-function run to the ONT implementation (the second case arm)" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      allow(pr).to receive(:ont_sfn_outputs_by_step).with(false).and_return("ont" => {})

      expect(pr.outputs_by_step(true)).to eq("ont" => {})
    end

    it "returns nil from sfn_outputs_by_step for an unknown technology (the case else)" do
      pr = create(:pipeline_run, sample: sample)
      pr.update_column(:technology, "some-future-sequencer") # rubocop:disable Rails/SkipsModelValidations

      expect(pr.reload.sfn_outputs_by_step).to be_nil
    end

    it "routes a legacy DAG run to the DAG implementation (the elsif-arm)" do
      pr = create(:pipeline_run, sample: sample,
                                 pipeline_execution_strategy: PipelineRun.pipeline_execution_strategies[:directed_acyclic_graph])
      allow(pr).to receive(:dag_outputs_by_step).with(false).and_return("dag" => {})

      expect(pr.outputs_by_step).to eq("dag" => {})
    end

    it "returns an empty hash when no execution strategy is set (the final fall-through)" do
      pr = create(:pipeline_run, sample: sample)
      pr.update_column(:pipeline_execution_strategy, nil) # rubocop:disable Rails/SkipsModelValidations

      expect(pr.reload.outputs_by_step).to eq({})
    end
  end

  describe "#check_and_log_long_run" do
    before { allow(Rails.logger).to receive(:error) }

    it "alerts once when a run has exceeded the threshold (both if then-arms)" do
      pr = create(:pipeline_run, sample: sample, alert_sent: 0)
      pr.update_column(:created_at, 20.hours.ago)  # rubocop:disable Rails/SkipsModelValidations

      pr.reload.check_and_log_long_run

      expect(Rails.logger).to have_received(:error).with(/LongRunningSampleEvent/)
      expect(pr.reload.alert_sent).to eq(1)
    end

    it "stays quiet while the run is under the threshold (the inner else-arm)" do
      pr = create(:pipeline_run, sample: sample, alert_sent: 0)

      pr.check_and_log_long_run

      expect(Rails.logger).not_to have_received(:error).with(/LongRunningSampleEvent/)
      expect(pr.reload.alert_sent).to eq(0)
    end

    it "stays quiet once an alert has already been sent (the outer else-arm)" do
      pr = create(:pipeline_run, sample: sample, alert_sent: 1)
      pr.update_column(:created_at, 40.hours.ago)  # rubocop:disable Rails/SkipsModelValidations

      pr.reload.check_and_log_long_run

      expect(Rails.logger).not_to have_received(:error).with(/LongRunningSampleEvent/)
      expect(pr.reload.alert_sent).to eq(1)
    end
  end

  describe "#job_status_display" do
    let(:pr) { create(:pipeline_run, sample: sample) }

    it "reports initializing when there is no job status (the guard then-arm)" do
      pr.update_column(:job_status, nil) # rubocop:disable Rails/SkipsModelValidations
      expect(pr.reload.job_status_display).to eq("Pipeline Initializing")
    end

    it "extracts the stage name from a stage-shaped status (the ternary then-arm)" do
      pr.update_column(:job_status, "1.Host Filtering-RUNNING") # rubocop:disable Rails/SkipsModelValidations
      expect(pr.reload.job_status_display).to eq("Running Host Filtering")
    end

    it "falls back to the raw status when it has no stage segment (the ternary else-arm)" do
      pr.update_column(:job_status, "CHECKED") # rubocop:disable Rails/SkipsModelValidations
      expect(pr.reload.job_status_display).to eq("CHECKED")
    end
  end

  describe "#time_since_executed_at" do
    it "measures the elapsed seconds when executed_at is set (the if-arm)" do
      pr = create(:pipeline_run, sample: sample, executed_at: 2.minutes.ago)
      expect(pr.send(:time_since_executed_at)).to be_within(30).of(120)
    end

    it "is nil when the run never started (the else-arm)" do
      pr = create(:pipeline_run, sample: sample, executed_at: nil)
      expect(pr.send(:time_since_executed_at)).to be_nil
    end
  end

  describe "#input_error" do
    let(:pr) { create(:pipeline_run, sample: sample) }

    it "returns the label and message for a known input error (the if-arm)" do
      known = WorkflowRun::INPUT_ERRORS.keys.first
      allow(pr).to receive(:sfn_execution)
        .and_return(instance_double(SfnExecution, pipeline_error: [known, "bad fastq"]))

      expect(pr.send(:input_error)).to eq(label: known, message: "bad fastq")
    end

    it "returns nil for an unrecognised error (the else-arm)" do
      allow(pr).to receive(:sfn_execution)
        .and_return(instance_double(SfnExecution, pipeline_error: ["SOME_INFRA_ERROR", "oops"]))

      expect(pr.send(:input_error)).to be_nil
    end
  end
end

# frozen_string_literal: true

require 'rails_helper'

# Coverage Wave (branch): second branch sweep for PipelineRun, complementing
# pipeline_run_branches_spec.rb. The model is dominated by S3/SFN-backed loaders,
# but a large set of pure path/format/stat helpers hang off a handful of
# predicates (step_function?, technology, pipeline_version, supports_assembly?)
# and are only ever driven down one arm by the existing specs. This file drives
# the other arm of each:
#
#   - S3 path builders: expt/postprocess/alignment-viz/host-filter/assembly paths
#     and output_s3_path_with_version, for step-function AND legacy DAG runs,
#     with and without a pipeline_version
#   - subsample_suffix / subsampled_reads / subsample_fraction
#   - s3_file_for: the missing-pipeline_version warning guard and the case arms
#     (including the unmatched-output else)
#   - nonhost_fastq_s3_paths: illumina single/paired + fasta/fastq, and nanopore
#   - unidentified_fasta_s3_path: assembly / >=2.0 / legacy
#   - host_subtracted, get_lineage_json, get_contigs_for_taxid
#   - summary_contig_counts: the illumina/nanopore count-key ternary and the
#     per-taxid presence guards
#   - load_qc_percent / load_compression_ratio: every technology + pipeline-version
#     arm and each unless-guard operand
#   - fetch_total_count_by_technology / fetch_adjusted_total_count_by_technology /
#     call_pipeline_data_service: illumina, nanopore, and the unmatched fall-through
#   - format_job_status_text / pipeline_run_stage_error_message ternaries
#   - extract_float_metric / extract_int_metric guards
#   - results_load_auto_heal_eligible?: each early return plus the rescue
RSpec.describe PipelineRun, type: :model do
  let(:project) { create(:project) }
  let(:sample) { create(:sample, project: project) }

  # A step-function run whose sfn_results_path is pinned, so path assertions are
  # about the branch taken rather than about SFN naming.
  def sfn_run(**attrs)
    pr = create(:pipeline_run, sample: sample, **attrs)
    allow(pr).to receive(:sfn_results_path).and_return("s3://bucket/results")
    pr
  end

  # A legacy (non-step-function) run: step_function? is false, so the path helpers
  # take their else arms.
  def dag_run(**attrs)
    create(:pipeline_run,
           sample: sample,
           pipeline_execution_strategy: PipelineRun.pipeline_execution_strategies[:directed_acyclic_graph],
           **attrs)
  end

  describe "S3 path helpers" do
    it "uses the SFN results path for every path helper on a step-function run" do
      pr = sfn_run(pipeline_version: "6.8")

      expect(pr.expt_output_s3_path).to eq("s3://bucket/results")
      expect(pr.postprocess_output_s3_path).to eq("s3://bucket/results")
      expect(pr.assembly_s3_path).to eq("s3://bucket/results")
      expect(pr.alignment_viz_output_s3_path).to eq("s3://bucket/results")
      expect(pr.host_filter_output_s3_path).to eq("s3://bucket/results")
      expect(pr.output_s3_path_with_version).to eq("s3://bucket/results")
    end

    it "builds versioned legacy paths for a DAG run with a pipeline_version (the else arms)" do
      pr = dag_run(pipeline_version: "3.6")

      expect(pr.expt_output_s3_path).to eq("#{sample.sample_expt_s3_path}/3.6")
      expect(pr.postprocess_output_s3_path).to eq("#{sample.sample_postprocess_s3_path}/3.6")
      expect(pr.assembly_s3_path).to eq("#{sample.sample_postprocess_s3_path}/3.6/assembly")
      expect(pr.alignment_viz_output_s3_path).to eq("#{sample.sample_postprocess_s3_path}/3.6/align_viz")
      expect(pr.output_s3_path_with_version).to eq("#{sample.sample_output_s3_path}/3.6")
      expect(pr.host_filter_output_s3_path).to eq("#{sample.sample_output_s3_path}/3.6")
    end

    it "omits the version segment for a DAG run without a pipeline_version (the nil arms)" do
      pr = dag_run(pipeline_version: nil)

      expect(pr.expt_output_s3_path).to eq(sample.sample_expt_s3_path)
      expect(pr.postprocess_output_s3_path).to eq(sample.sample_postprocess_s3_path)
      expect(pr.alignment_output_s3_path).to eq(sample.sample_output_s3_path)
      expect(pr.output_s3_path_with_version).to eq(sample.sample_output_s3_path)
    end

    it "includes the version segment in alignment_output_s3_path when set" do
      pr = dag_run(pipeline_version: "3.6")
      expect(pr.alignment_output_s3_path).to eq("#{sample.sample_output_s3_path}/3.6")
    end

    it "derives the byterange paths from the assembly path when assembly is supported" do
      pr = sfn_run(pipeline_version: "6.8")
      paths = pr.s3_paths_for_taxon_byteranges

      expect(pr.send(:supports_assembly?)).to be(true)
      expect(paths[TaxonCount::TAX_LEVEL_SPECIES]['NT'])
        .to eq("s3://bucket/results/#{PipelineRun::ASSEMBLY_PREFIX}#{PipelineRun::SORTED_TAXID_ANNOTATED_FASTA}")
    end

    it "derives the byterange paths from the postprocess path when assembly is not supported" do
      pr = dag_run(pipeline_version: "1.0")
      paths = pr.s3_paths_for_taxon_byteranges

      expect(pr.send(:supports_assembly?)).to be(false)
      expect(paths[TaxonCount::TAX_LEVEL_SPECIES]['NT'])
        .to eq("#{sample.sample_postprocess_s3_path}/1.0/#{pr.subsample_suffix}/#{PipelineRun::SORTED_TAXID_ANNOTATED_FASTA}")
    end
  end

  describe "#subsample_suffix" do
    it "returns nil for a pipeline at version 2 or later (the early return)" do
      expect(dag_run(pipeline_version: "3.6").subsample_suffix).to be_nil
    end

    it "returns the subsample folder when a subsample is set (the ternary then-arm)" do
      expect(dag_run(pipeline_version: "1.0", subsample: 1000).subsample_suffix).to eq("subsample_1000")
    end

    it "returns 'subsample_all' for a versioned legacy run with no subsample" do
      expect(dag_run(pipeline_version: "1.0", subsample: nil).subsample_suffix).to eq("subsample_all")
    end

    it "returns an empty suffix for an unversioned legacy run with no subsample" do
      expect(dag_run(pipeline_version: nil, subsample: nil).subsample_suffix).to eq("")
    end
  end

  describe "#subsampled_reads and #subsample_fraction" do
    it "returns the remaining reads untouched when there is no subsample (the if not taken)" do
      pr = sfn_run(subsample: nil, adjusted_remaining_reads: 500)
      expect(pr.subsampled_reads).to eq(500)
    end

    it "caps the remaining reads at the subsample ceiling (the inner then-arm)" do
      pr = sfn_run(subsample: 10, adjusted_remaining_reads: 500)
      allow(pr).to receive_message_chain(:sample, :input_files, :fastq, :count).and_return(2)
      expect(pr.subsampled_reads).to eq(20)
    end

    it "leaves the remaining reads alone when they are under the ceiling (the inner else-arm)" do
      pr = sfn_run(subsample: 1000, adjusted_remaining_reads: 500)
      allow(pr).to receive_message_chain(:sample, :input_files, :fastq, :count).and_return(2)
      expect(pr.subsampled_reads).to eq(500)
    end

    it "prefers a recorded fraction_subsampled when present (the if-arm)" do
      expect(sfn_run(fraction_subsampled: 0.25).subsample_fraction).to eq(0.25)
    end

    it "computes the fraction from the subsampled reads when none is recorded (the else-arm)" do
      pr = sfn_run(fraction_subsampled: nil, subsample: 10, adjusted_remaining_reads: 500)
      allow(pr).to receive_message_chain(:sample, :input_files, :fastq, :count).and_return(1)
      expect(pr.subsample_fraction).to eq(10 / 500.0)
    end

    it "falls back to 1.0 when there are no remaining reads (the inner ternary else-arm)" do
      pr = sfn_run(fraction_subsampled: nil, subsample: nil, adjusted_remaining_reads: 0)
      expect(pr.subsample_fraction).to eq(1.0)
    end
  end

  describe "#s3_file_for" do
    it "logs an error when neither a pipeline_version nor finalized is set (the unless then-arm)" do
      pr = sfn_run(pipeline_version: nil)
      # finalized is an integer column defaulting to 0, and 0 is truthy in Ruby,
      # so the guard only fires when the attribute is genuinely nil. Set it
      # in-memory (the column is NOT NULL) to drive the then-arm.
      pr.finalized = nil
      expect(LogUtil).to receive(:log_error).with(/without a pipeline_version/, hash_including(:pipeline_run_id))

      pr.s3_file_for("contigs")
    end

    it "does not log when the run is finalized without a version (the right || operand)" do
      pr = sfn_run(pipeline_version: nil, finalized: 1)
      expect(LogUtil).not_to receive(:log_error)

      pr.s3_file_for("contigs")
    end

    it "does not log when a pipeline_version is present (the left || operand)" do
      pr = sfn_run(pipeline_version: "6.8", finalized: 0)
      expect(LogUtil).not_to receive(:log_error)

      pr.s3_file_for("contigs")
    end

    it "maps each known output onto its S3 location" do
      pr = sfn_run(pipeline_version: "6.8")

      expect(pr.s3_file_for("ercc_counts")).to eq("s3://bucket/results/#{pr.ercc_output_path}")
      expect(pr.s3_file_for("amr_counts")).to eq("s3://bucket/results/#{PipelineRun::AMR_FULL_RESULTS_NAME}")
      expect(pr.s3_file_for("taxon_counts")).to eq("s3://bucket/results/#{PipelineRun::REFINED_TAXON_COUNTS_JSON_NAME}")
      expect(pr.s3_file_for("taxon_byteranges")).to eq("s3://bucket/results/#{PipelineRun::REFINED_TAXID_BYTERANGE_JSON_NAME}")
      expect(pr.s3_file_for("contigs")).to eq("s3://bucket/results/#{PipelineRun::ASSEMBLED_STATS_NAME}")
      expect(pr.s3_file_for("contig_counts")).to eq("s3://bucket/results/#{PipelineRun::CONTIG_SUMMARY_JSON_NAME}")
      expect(pr.s3_file_for("contig_bases")).to eq("s3://bucket/results/#{PipelineRun::CONTIG_BASE_COUNTS_NAME}")
      expect(pr.s3_file_for("insert_size_metrics"))
        .to eq("s3://bucket/results/#{PipelineRun::INSERT_SIZE_METRICS_OUTPUT_NAME}")
      expect(pr.s3_file_for("accession_coverage_stats")).to eq(pr.coverage_viz_summary_s3_path)
    end

    it "falls through the case with no match for an unrecognised output (the case else)" do
      # The case has no else branch, so an unmatched output leaves full_path nil
      # and the trailing `full_path.start_with?("/")` guard blows up. Pin the
      # actual behaviour rather than a nil return.
      pr = sfn_run(pipeline_version: "6.8")
      expect { pr.s3_file_for("not_an_output") }.to raise_error(NoMethodError, /start_with\?/)
    end
  end

  describe "#nonhost_fastq_s3_paths" do
    it "returns a single fastq path for a single-end illumina run" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      allow(pr.sample).to receive(:fasta_input?).and_return(false)
      allow(pr.sample).to receive_message_chain(:input_files, :fastq, :length).and_return(1)

      expect(pr.nonhost_fastq_s3_paths).to eq(["s3://bucket/results/nonhost_R1.fastq"])
    end

    it "adds the R2 path for a paired-end illumina run (the length == 2 arm)" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      allow(pr.sample).to receive(:fasta_input?).and_return(false)
      allow(pr.sample).to receive_message_chain(:input_files, :fastq, :length).and_return(2)

      expect(pr.nonhost_fastq_s3_paths).to eq([
                                                "s3://bucket/results/nonhost_R1.fastq",
                                                "s3://bucket/results/nonhost_R2.fastq",
                                              ])
    end

    it "uses the fasta extension for a fasta upload (the ternary then-arm)" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      allow(pr.sample).to receive(:fasta_input?).and_return(true)
      allow(pr.sample).to receive_message_chain(:input_files, :fastq, :length).and_return(1)

      expect(pr.nonhost_fastq_s3_paths).to eq(["s3://bucket/results/nonhost_R1.fasta"])
    end

    it "returns the single ONT reads path for a nanopore run (the else arm)" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])

      expect(pr.nonhost_fastq_s3_paths).to eq("s3://bucket/results/#{PipelineRun::ONT_NONHOST_READS_NAME}")
    end

    it "honours the prefix argument" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      allow(pr.sample).to receive(:fasta_input?).and_return(false)
      allow(pr.sample).to receive_message_chain(:input_files, :fastq, :length).and_return(1)

      expect(pr.nonhost_fastq_s3_paths("pre_")).to eq(["s3://bucket/results/pre_nonhost_R1.fastq"])
    end
  end

  describe "#unidentified_fasta_s3_path" do
    it "uses the assembly path when assembly is supported (the first guard)" do
      pr = sfn_run(pipeline_version: "6.8")
      expect(pr.unidentified_fasta_s3_path)
        .to eq("s3://bucket/results/#{PipelineRun::ASSEMBLY_PREFIX}#{PipelineRun::DAG_UNIDENTIFIED_FASTA_BASENAME}")
    end

    it "uses the versioned output path for a >=2.0 run without assembly (the second guard)" do
      pr = dag_run(pipeline_version: "2.4", technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      expect(pr.unidentified_fasta_s3_path)
        .to eq("#{sample.sample_output_s3_path}/2.4/#{PipelineRun::DAG_UNIDENTIFIED_FASTA_BASENAME}")
    end

    it "falls back to the alignment path for a legacy 1.x run (neither guard)" do
      pr = dag_run(pipeline_version: "1.0", technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      expect(pr.unidentified_fasta_s3_path)
        .to eq("#{sample.sample_output_s3_path}/1.0/subsample_all/#{PipelineRun::UNIDENTIFIED_FASTA_BASENAME}")
    end
  end

  describe "#host_subtracted" do
    it "reports ERCC Only for an ercc-only host genome (the ternary then-arm)" do
      pr = sfn_run
      allow(pr.sample).to receive(:host_genome).and_return(double("hg", ercc_only?: true, name: "ERCC"))
      expect(pr.host_subtracted).to eq("ERCC Only")
    end

    it "reports the host genome name otherwise (the ternary else-arm)" do
      pr = sfn_run
      allow(pr.sample).to receive(:host_genome).and_return(double("hg", ercc_only?: false, name: "Human"))
      expect(pr.host_subtracted).to eq("Human")
    end
  end

  describe "#get_lineage_json" do
    let(:pr) { sfn_run }

    it "returns an empty hash when there is no contig->taxid mapping (the if not taken)" do
      expect(pr.get_lineage_json(nil, {})).to eq({})
    end

    it "maps each count type to its lineage when found (no error logged)" do
      expect(LogUtil).not_to receive(:log_error)
      lineage = pr.get_lineage_json({ "NT" => 573 }, { 573 => [573, 570] })
      expect(lineage).to eq("NT" => [573, 570])
    end

    it "logs a lineage-not-found error for a positive taxid with no lineage (both && operands true)" do
      expect(LogUtil).to receive(:log_error).with(/No lineage found for taxid 573/, hash_including(:exception))
      expect(pr.get_lineage_json({ "NT" => 573 }, {})).to eq("NT" => nil)
    end

    it "does not log for a non-positive taxid with no lineage (the right && operand false)" do
      expect(LogUtil).not_to receive(:log_error)
      expect(pr.get_lineage_json({ "NT" => -200 }, {})).to eq("NT" => nil)
    end
  end

  describe "#get_contigs_for_taxid" do
    let(:pr) { sfn_run }

    before do
      create(:contig, pipeline_run: pr, name: "nt_hit", read_count: 10,
                      lineage_json: { "NT" => [573, 570], "NR" => [1, 2] }.to_json)
      create(:contig, pipeline_run: pr, name: "nr_hit", read_count: 9,
                      lineage_json: { "NT" => [1, 2], "NR" => [573, 570] }.to_json)
      create(:contig, pipeline_run: pr, name: "no_hit", read_count: 8,
                      lineage_json: { "NT" => [9], "NR" => [9] }.to_json)
    end

    it "matches only NT lineages when db is NT (the first arm)" do
      expect(pr.get_contigs_for_taxid(573, "NT").pluck(:name)).to eq(["nt_hit"])
    end

    it "matches only NR lineages when db is NR (the elsif arm)" do
      expect(pr.get_contigs_for_taxid(573, "NR").pluck(:name)).to eq(["nr_hit"])
    end

    it "matches across every lineage for the default db (the final elsif arm)" do
      expect(pr.get_contigs_for_taxid(573).pluck(:name)).to contain_exactly("nt_hit", "nr_hit")
    end

    it "returns nothing when the taxid is absent from every lineage" do
      expect(pr.get_contigs_for_taxid(4444).pluck(:name)).to eq([])
    end
  end

  describe "#summary_contig_counts" do
    it "counts by read_count for an illumina run and skips nil taxids" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      create(:contig, pipeline_run: pr, read_count: 5, base_count: 50,
                      lineage_json: { "NT" => [573] }.to_json,
                      species_taxid_nt: 573, species_taxid_nr: nil,
                      genus_taxid_nt: 570, genus_taxid_nr: nil)

      summary = pr.summary_contig_counts

      expect(summary[573]["nt"][5]).to eq(1)
      expect(summary[570]["nt"][5]).to eq(1)
      expect(summary.key?(nil)).to be(false)
    end

    it "counts by base_count for a nanopore run (the ternary else-arm)" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      create(:contig, pipeline_run: pr, read_count: 5, base_count: 50,
                      lineage_json: { "NR" => [573] }.to_json,
                      species_taxid_nt: nil, species_taxid_nr: 573,
                      genus_taxid_nt: nil, genus_taxid_nr: 570)

      summary = pr.summary_contig_counts

      expect(summary[573]["nr"][50]).to eq(1)
      expect(summary[570]["nr"][50]).to eq(1)
    end

    it "counts the merged NT/NR taxids when they are set" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      create(:contig, pipeline_run: pr, read_count: 2, base_count: 20,
                      lineage_json: { "NT" => [573] }.to_json,
                      species_taxid_merged_nt_nr: 573, genus_taxid_merged_nt_nr: 570)

      summary = pr.summary_contig_counts

      expect(summary[573]["merged_nt_nr"][2]).to eq(1)
      expect(summary[570]["merged_nt_nr"][2]).to eq(1)
    end
  end

  describe "#load_qc_percent" do
    def stats(reads_after)
      { 'reads_after' => reads_after }
    end

    it "uses validated vs quality-filtered reads for a nanopore run (the technology if-arm)" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      pr.load_qc_percent('validated_reads' => stats(200), 'quality_filtered_reads' => stats(100))

      expect(pr.reload.qc_percent).to be_within(0.01).of(50.0)
    end

    it "leaves qc_percent unset for nanopore when a stat is missing (the unless guard)" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore], qc_percent: nil)
      pr.load_qc_percent('validated_reads' => stats(200))

      expect(pr.reload.qc_percent).to be_nil
    end

    it "leaves qc_percent unset for nanopore when the divisor is zero (the zero? guard)" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore], qc_percent: nil)
      pr.load_qc_percent('validated_reads' => stats(0), 'quality_filtered_reads' => stats(100))

      expect(pr.reload.qc_percent).to be_nil
    end

    it "uses fastp vs bowtie2-ERCC for a >=8.2 illumina run (the first inner arm)" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina], pipeline_version: "8.2")
      pr.load_qc_percent('fastp_out' => stats(50), 'bowtie2_ercc_filtered_out' => stats(100))

      expect(pr.reload.qc_percent).to be_within(0.01).of(50.0)
    end

    it "uses fastp vs validate_input for an 8.0 illumina run (the elsif arm)" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina], pipeline_version: "8.0")
      pr.load_qc_percent('fastp_out' => stats(25), 'validate_input_out' => stats(100))

      expect(pr.reload.qc_percent).to be_within(0.01).of(25.0)
    end

    it "uses priceseq vs star for a legacy illumina run (the else arm)" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina], pipeline_version: "6.8")
      pr.load_qc_percent('priceseq_out' => stats(10), 'star_out' => stats(100))

      expect(pr.reload.qc_percent).to be_within(0.01).of(10.0)
    end

    it "leaves qc_percent unset for a legacy illumina run with a missing stat" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina], pipeline_version: "6.8", qc_percent: nil)
      pr.load_qc_percent('priceseq_out' => stats(10))

      expect(pr.reload.qc_percent).to be_nil
    end
  end

  describe "#load_compression_ratio" do
    def stats(reads_after)
      { 'reads_after' => reads_after }
    end

    it "uses hisat2 vs dedup for a new-host-filtering run (the if-arm)" do
      pr = sfn_run(pipeline_version: "8.0")
      pr.load_compression_ratio('hisat2_human_filtered_out' => stats(100), 'czid_dedup_out' => stats(50))

      expect(pr.reload.compression_ratio).to be_within(0.01).of(2.0)
    end

    it "falls back to the host (non-human) hisat2 stats when no human stats exist (the || arm)" do
      pr = sfn_run(pipeline_version: "8.0")
      pr.load_compression_ratio('hisat2_host_filtered_out' => stats(90), 'czid_dedup_out' => stats(30))

      expect(pr.reload.compression_ratio).to be_within(0.01).of(3.0)
    end

    it "leaves the ratio unset for a new-host-filtering run with a zero divisor" do
      pr = sfn_run(pipeline_version: "8.0", compression_ratio: nil)
      pr.load_compression_ratio('hisat2_human_filtered_out' => stats(100), 'czid_dedup_out' => stats(0))

      expect(pr.reload.compression_ratio).to be_nil
    end

    it "uses priceseq vs dedup for a legacy run (the else arm)" do
      pr = sfn_run(pipeline_version: "6.8")
      pr.load_compression_ratio('priceseq_out' => stats(80), 'czid_dedup_out' => stats(20))

      expect(pr.reload.compression_ratio).to be_within(0.01).of(4.0)
    end

    it "leaves the ratio unset for a legacy run with a missing dedup stat" do
      pr = sfn_run(pipeline_version: "6.8", compression_ratio: nil)
      pr.load_compression_ratio('priceseq_out' => stats(80))

      expect(pr.reload.compression_ratio).to be_nil
    end

    it "prefers the idseq_dedup stats when czid_dedup is absent (the second || operand)" do
      pr = sfn_run(pipeline_version: "6.8")
      pr.load_compression_ratio('priceseq_out' => stats(80), 'idseq_dedup_out' => stats(40))

      expect(pr.reload.compression_ratio).to be_within(0.01).of(2.0)
    end
  end

  describe "technology dispatch helpers" do
    it "returns total_reads / adjusted totals / the illumina data service for an illumina run" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina],
                   total_reads: 1000, total_ercc_reads: 100, fraction_subsampled: 0.5)

      expect(pr.fetch_total_count_by_technology).to eq(1000)
      expect(pr.fetch_adjusted_total_count_by_technology).to eq(450.0)
      expect(SfnPipelineDataService).to receive(:call).with(pr.id, false, true).and_return(:illumina_result)
      expect(pr.call_pipeline_data_service(false, true)).to eq(:illumina_result)
    end

    it "returns total_bases / the single-stage data service for a nanopore run (the elsif arms)" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore], total_bases: 4242)

      expect(pr.fetch_total_count_by_technology).to eq(4242)
      expect(pr.fetch_adjusted_total_count_by_technology).to eq(4242)
      expect(SfnSingleStagePipelineDataService)
        .to receive(:call).with(pr.id, PipelineRun::TECHNOLOGY_INPUT[:nanopore], false).and_return(:ont_result)
      expect(pr.call_pipeline_data_service(true, false)).to eq(:ont_result)
    end

    it "returns nil for an unrecognised technology (the fall-through with neither arm taken)" do
      pr = sfn_run(technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      pr.technology = "Sequencer 9000"

      expect(pr.fetch_total_count_by_technology).to be_nil
      expect(pr.fetch_adjusted_total_count_by_technology).to be_nil
      expect(pr.call_pipeline_data_service(false, false)).to be_nil
    end
  end

  describe "private formatting helpers" do
    let(:pr) { sfn_run }

    it "appends the ready marker to the job status text when the report is ready (ternary then-arm)" do
      expect(pr.send(:format_job_status_text, 1, "host_filter", "RUNNING", true))
        .to eq("1.host_filter-RUNNING|#{PipelineRun::STATUS_READY}")
    end

    it "omits the ready marker when the report is not ready (ternary else-arm)" do
      expect(pr.send(:format_job_status_text, 1, "host_filter", "RUNNING", false))
        .to eq("1.host_filter-RUNNING")
    end

    it "builds a failure message with reads remaining, restart and user-error text (all then-arms)" do
      pr.update!(adjusted_remaining_reads: 42)
      prs = double("prs", step_number: 2, name: "alignment")

      message = pr.send(:pipeline_run_stage_error_message, prs, true, "INSUFFICIENT_READS")

      expect(message).to include("with 42 reads remaining")
      expect(message).to include("Automatic restart is being triggered.")
      expect(message).to include("Known user error INSUFFICIENT_READS.")
    end

    it "builds a failure message with the manual-action text and no reads/user-error (all else-arms)" do
      pr.update!(adjusted_remaining_reads: nil)
      prs = double("prs", step_number: 2, name: "alignment")

      message = pr.send(:pipeline_run_stage_error_message, prs, false, nil)

      expect(message).to include("** Manual action required **.")
      expect(message).not_to include("reads remaining")
      expect(message).not_to include("Known user error")
    end

    it "extracts float and int metrics when present and nil when absent" do
      expect(pr.send(:extract_float_metric, { "MEAN" => "1.5" }, "MEAN")).to eq(1.5)
      expect(pr.send(:extract_float_metric, {}, "MEAN")).to be_nil
      expect(pr.send(:extract_int_metric, { "N" => "7" }, "N")).to eq(7)
      expect(pr.send(:extract_int_metric, {}, "N")).to be_nil
    end

    it "computes the qc percent from the before/after counts" do
      expect(pr.send(:calculate_qc_percent, 200, 50)).to eq(25.0)
    end
  end

  describe "#results_load_auto_heal_eligible?" do
    it "is false once the retry budget is spent (the first early return)" do
      pr = sfn_run(results_load_retry_count: PipelineRun::RESULTS_LOAD_RETRY_LIMIT)
      expect(pr.results_load_auto_heal_eligible?).to be(false)
    end

    it "is false for a known user error (the second early return, left operand)" do
      pr = sfn_run(results_load_retry_count: 0, known_user_error: "INSUFFICIENT_READS")
      expect(pr.results_load_auto_heal_eligible?).to be(false)
    end

    it "is false for an input error (the second early return, right operand)" do
      pr = sfn_run(results_load_retry_count: 0, known_user_error: nil)
      allow(pr).to receive(:input_error).and_return(label: "INVALID_INPUT", message: "bad")
      expect(pr.results_load_auto_heal_eligible?).to be(false)
    end

    it "is true when SFN reports success and the budget is intact (the final expression)" do
      pr = sfn_run(results_load_retry_count: 0, known_user_error: nil)
      allow(pr).to receive(:input_error).and_return(nil)
      allow(pr).to receive(:sfn_execution)
        .and_return(double("sfn", description: { status: WorkflowRun::STATUS[:succeeded] }))

      expect(pr.results_load_auto_heal_eligible?).to be(true)
    end

    it "is false when SFN reports a non-success status" do
      pr = sfn_run(results_load_retry_count: 0, known_user_error: nil)
      allow(pr).to receive(:input_error).and_return(nil)
      allow(pr).to receive(:sfn_execution).and_return(double("sfn", description: { status: "FAILED" }))

      expect(pr.results_load_auto_heal_eligible?).to be(false)
    end

    it "is false and logs when probing SFN raises (the rescue arm)" do
      pr = sfn_run(results_load_retry_count: 0, known_user_error: nil)
      allow(pr).to receive(:input_error).and_return(nil)
      allow(pr).to receive(:sfn_execution).and_raise(StandardError, "sfn down")
      expect(LogUtil).to receive(:log_error).with(/auto-heal eligibility/, hash_including(:exception))

      expect(pr.results_load_auto_heal_eligible?).to be(false)
    end
  end
end

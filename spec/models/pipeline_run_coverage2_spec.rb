require "rails_helper"

# Coverage Wave 1 (cov-w1): drive BOTH arms of the many conditionals in
# PipelineRun that the existing pipeline_run_spec.rb and
# pipeline_run_coverage_spec.rb do not exercise. The priority is BRANCH
# coverage, so every describe block below is deliberately paired: happy path +
# the untaken (nil / error / else / rescue / legacy-version) arm.
#
# Spec-only: no app code is changed. Where current behavior looks like a latent
# bug it is PINNED (characterization) with a comment, not fixed.
describe PipelineRun, type: :model do
  create_users

  let(:project) { create(:project, users: [@joe], name: "Cov2 Project") }
  let(:sample) { create(:sample, project: project, user: @joe, name: "cov2_sample") }

  before do
    @mock_aws_clients = {
      s3: Aws::S3::Client.new(stub_responses: true),
      states: Aws::States::Client.new(stub_responses: true),
    }
    allow(AwsClient).to receive(:[]) { |client| @mock_aws_clients[client] }
  end

  # ---------------------------------------------------------------------------
  # #ercc_output_path / #db_load_ercc_counts
  # ---------------------------------------------------------------------------
  describe "#db_load_ercc_counts" do
    let(:pr) do
      create(:pipeline_run, sample: sample, pipeline_version: "8.1.0",
                            sfn_execution_arn: "fake-arn", s3_output_prefix: "s3://prefix", wdl_version: "8.1")
    end

    it "returns early when the aws s3 ls fails (non-zero exit)" do
      failed = instance_double(Process::Status, exitstatus: 1)
      allow(Open3).to receive(:capture3).and_return(["", "", failed])
      expect(Syscall).not_to receive(:pipe_with_output)
      expect(pr.db_load_ercc_counts).to be_nil
    end

    it "parses ERCC lines and updates counts when the s3 ls succeeds (bowtie2 path, no fastq multiply)" do
      ok = instance_double(Process::Status, exitstatus: 0)
      allow(Open3).to receive(:capture3).and_return(["", "", ok])
      allow(Syscall).to receive(:pipe_with_output).and_return("ERCC-1\t5\nERCC-2\t7\n")
      pr.db_load_ercc_counts
      expect(pr.reload.total_ercc_reads).to eq(12)
      expect(pr.ercc_counts.pluck(:name, :count)).to match_array([["ERCC-1", 5], ["ERCC-2", 7]])
    end

    it "multiplies ERCC reads by the fastq count for pre-bowtie2 versions" do
      old_pr = create(:pipeline_run, sample: sample, pipeline_version: "7.0.0",
                                     sfn_execution_arn: "fake-arn", s3_output_prefix: "s3://prefix", wdl_version: "7.0")
      ok = instance_double(Process::Status, exitstatus: 0)
      allow(Open3).to receive(:capture3).and_return(["", "", ok])
      allow(Syscall).to receive(:pipe_with_output).and_return("ERCC-1\t5\n")
      # 2 fastq input files (factory default) => 5 * 2 = 10
      old_pr.db_load_ercc_counts
      expect(old_pr.reload.total_ercc_reads).to eq(10)
    end
  end

  # ---------------------------------------------------------------------------
  # #should_have_insert_size_metrics — new vs legacy host-filtering + rescue
  # ---------------------------------------------------------------------------
  describe "#should_have_insert_size_metrics" do
    it "checks the s3 head_object for new host filtering versions (present => true)" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "8.0.0",
                                 sfn_execution_arn: "fake-arn", s3_output_prefix: "s3://prefix", wdl_version: "8.0",
                                 pipeline_run_stages_data: [{ step_number: 1 }])
      s3 = @mock_aws_clients[:s3]
      allow(s3).to receive(:head_object).and_return(Aws::S3::Types::HeadObjectOutput.new(content_length: 10))
      expect(pr.should_have_insert_size_metrics).to be(true)
    end

    it "returns false when head_object raises NotFound (rescue arm)" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "8.0.0",
                                 sfn_execution_arn: "fake-arn", s3_output_prefix: "s3://prefix", wdl_version: "8.0",
                                 pipeline_run_stages_data: [{ step_number: 1 }])
      s3 = @mock_aws_clients[:s3]
      allow(s3).to receive(:head_object).and_raise(Aws::S3::Errors::NotFound.new(nil, "not found"))
      expect(pr.should_have_insert_size_metrics).to be(false)
    end

    it "uses the star_out additional outputs for legacy versions" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "6.0.0",
                                 pipeline_run_stages_data: [{ step_number: 1 }])
      stage = pr.host_filtering_stage
      allow(stage).to receive(:step_statuses).and_return(
        "star_out" => { "additional_output" => [PipelineRun::INSERT_SIZE_METRICS_OUTPUT_NAME] }
      )
      allow(pr).to receive(:host_filtering_stage).and_return(stage)
      expect(pr.should_have_insert_size_metrics).to be(true)
    end

    it "returns false for legacy versions when the metrics output is absent" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "6.0.0",
                                 pipeline_run_stages_data: [{ step_number: 1 }])
      stage = pr.host_filtering_stage
      allow(stage).to receive(:step_statuses).and_return("star_out" => { "additional_output" => [] })
      allow(pr).to receive(:host_filtering_stage).and_return(stage)
      expect(pr.should_have_insert_size_metrics).to be(false)
    end
  end

  # ---------------------------------------------------------------------------
  # #db_load_insert_size_metrics
  # ---------------------------------------------------------------------------
  describe "#db_load_insert_size_metrics" do
    let(:pr) do
      create(:pipeline_run, sample: sample, pipeline_version: "6.0.0")
    end

    it "returns early when the aws s3 ls fails" do
      failed = instance_double(Process::Status, exitstatus: 1)
      allow(Open3).to receive(:capture3).and_return(["", "", failed])
      expect(Syscall).not_to receive(:pipe_with_output)
      expect(pr.db_load_insert_size_metrics).to be_nil
    end

    it "parses the METRICS CLASS block and creates an insert_size_metric_set" do
      ok = instance_double(Process::Status, exitstatus: 0)
      allow(Open3).to receive(:capture3).and_return(["", "", ok])
      raw = [
        "## htsjdk.samtools.metrics.StringHeader",
        "## METRICS CLASS\tpicard.analysis.InsertSizeMetrics",
        "MEDIAN_INSERT_SIZE\tMODE_INSERT_SIZE\tMEDIAN_ABSOLUTE_DEVIATION\tMIN_INSERT_SIZE\tMAX_INSERT_SIZE\tMEAN_INSERT_SIZE\tSTANDARD_DEVIATION\tREAD_PAIRS",
        "300\t250\t20\t35\t900\t305.5\t45.2\t1000",
      ].join("\n") + "\n"
      allow(Syscall).to receive(:pipe_with_output).and_return(raw)
      pr.db_load_insert_size_metrics
      set = pr.reload.insert_size_metric_set
      expect(set.median).to eq(300)
      expect(set.mean).to be_within(0.01).of(305.5)
      expect(set.read_pairs).to eq(1000)
    end

    it "raises when the metrics rows cannot be found (tsv_lines != 2)" do
      ok = instance_double(Process::Status, exitstatus: 0)
      allow(Open3).to receive(:capture3).and_return(["", "", ok])
      # No "## METRICS CLASS" header => zero tsv_lines collected
      allow(Syscall).to receive(:pipe_with_output).and_return("garbage\nlines\nonly\n")
      allow(LogUtil).to receive(:log_error)
      expect { pr.db_load_insert_size_metrics }.to raise_error(/insert size metrics file but metrics could not be found/)
    end
  end

  # ---------------------------------------------------------------------------
  # #db_load_accession_coverage_stats + #format_accession_coverage_stats
  # ---------------------------------------------------------------------------
  describe "#db_load_accession_coverage_stats" do
    let(:pr) do
      create(:pipeline_run, sample: sample, pipeline_version: "7.0.0",
                            sfn_execution_arn: "fake-arn", s3_output_prefix: "s3://prefix", wdl_version: "7.0")
    end

    it "returns early when the coverage viz summary is blank" do
      allow(S3Util).to receive(:get_s3_file).and_return(nil)
      expect(pr.db_load_accession_coverage_stats).to be_nil
      expect(pr.accession_coverage_stats).to be_empty
    end

    it "loads accession coverage stats when coverage_breadth is present inline" do
      summary = {
        "573" => { "best_accessions" => [{ "id" => "ACC1", "name" => "acc one", "num_contigs" => 2, "num_reads" => 10, "score" => 1.5, "coverage_depth" => 3.2, "coverage_breadth" => 0.9 }] },
      }.to_json
      allow(S3Util).to receive(:get_s3_file).and_return(summary)
      pr.db_load_accession_coverage_stats
      stat = pr.reload.accession_coverage_stats.first
      expect(stat.accession_id).to eq("ACC1")
      expect(stat.coverage_breadth).to be_within(0.001).of(0.9)
    end

    it "skips taxa whose best_accessions is empty (top_accession nil)" do
      summary = { "573" => { "best_accessions" => [] } }.to_json
      allow(S3Util).to receive(:get_s3_file).and_return(summary)
      pr.db_load_accession_coverage_stats
      expect(pr.reload.accession_coverage_stats).to be_empty
    end

    describe "#format_accession_coverage_stats (fetch-breadth fallback for old versions)" do
      let(:accession) { { "id" => "ACC2", "name" => "acc two", "num_contigs" => 1, "num_reads" => 5, "score" => 2.0, "coverage_depth" => 1.1 } }

      it "fetches breadth from the per-accession file when missing inline" do
        allow(pr).to receive(:coverage_viz_data_s3_path).and_return("s3://prefix/ACC2_coverage_viz.json")
        allow(S3Util).to receive(:get_s3_file).with("s3://prefix/ACC2_coverage_viz.json").and_return({ "coverage_breadth" => 0.42 }.to_json)
        stats = pr.format_accession_coverage_stats(accession, "573")
        expect(stats[:coverage_breadth]).to be_within(0.001).of(0.42)
      end

      it "returns early (nil) and logs when the per-accession file is blank" do
        allow(pr).to receive(:coverage_viz_data_s3_path).and_return("s3://prefix/ACC2_coverage_viz.json")
        allow(S3Util).to receive(:get_s3_file).with("s3://prefix/ACC2_coverage_viz.json").and_return(nil)
        expect(Rails.logger).to receive(:error).with(/No coverage viz file found/)
        expect(pr.format_accession_coverage_stats(accession, "573")).to be_nil
      end

      it "leaves breadth unset when the per-accession file is present but empty JSON" do
        allow(pr).to receive(:coverage_viz_data_s3_path).and_return("s3://prefix/ACC2_coverage_viz.json")
        allow(S3Util).to receive(:get_s3_file).with("s3://prefix/ACC2_coverage_viz.json").and_return("{}")
        stats = pr.format_accession_coverage_stats(accession, "573")
        expect(stats).not_to have_key(:coverage_breadth)
      end
    end
  end

  # ---------------------------------------------------------------------------
  # #invalid_family_call?
  # ---------------------------------------------------------------------------
  describe "#invalid_family_call?" do
    let(:pr) { build(:pipeline_run, sample: sample) }

    it "is true when family_taxid is below the invalid-call base id" do
      expect(pr.invalid_family_call?("family_taxid" => (TaxonLineage::INVALID_CALL_BASE_ID - 1).to_s)).to be(true)
    end

    it "is false for a normal positive family_taxid" do
      expect(pr.invalid_family_call?("family_taxid" => "573")).to be(false)
    end

    it "rescues to false when family_taxid is missing (nil.to_i => 0, still >= base id)" do
      # nil["family_taxid"] path: {} has no key -> nil.to_i == 0, 0 < base(-1e8) is false
      expect(pr.invalid_family_call?({})).to be(false)
    end
  end

  # ---------------------------------------------------------------------------
  # #load_taxons — skip-when-already-loaded arm + full load arm
  # ---------------------------------------------------------------------------
  describe "#load_taxons" do
    let(:pr) do
      create(:pipeline_run, sample: sample, pipeline_version: "6.0.0",
                            technology: PipelineRun::TECHNOLOGY_INPUT[:illumina],
                            total_reads: 1_000_000, fraction_subsampled: 1.0)
    end

    def write_json(dict)
      path = Rails.root.join("tmp", "load_taxons_#{SecureRandom.hex(4)}.json").to_s
      File.write(path, dict.to_json)
      path
    end

    it "skips loading when records already exist for the count type" do
      create(:taxon_count, pipeline_run: pr, count_type: "NT", tax_level: TaxonCount::TAX_LEVEL_SPECIES)
      path = write_json("pipeline_output" => { "taxon_counts_attributes" => [] })
      expect(TaxonCount).not_to receive(:import!)
      pr.load_taxons(path, false)
    end

    it "imports species-level counts and runs downstream aggregations (multihit false)" do
      # pipeline_version 6.0.0 => multihit? true (>=1.5). Use a low version to keep multihit false
      # so the generate_aggregate_counts / update_genera branch is taken.
      low_pr = create(:pipeline_run, sample: sample, pipeline_version: "1.0",
                                     technology: PipelineRun::TECHNOLOGY_INPUT[:illumina],
                                     total_reads: 1_000_000, fraction_subsampled: 1.0)
      attrs = [{
        "tax_id" => 573, "tax_level" => 1, "count_type" => "NT", "count" => 100,
        "percent_identity" => 95.0, "alignment_length" => 100, "e_value" => -10,
        "family_taxid" => 570, "dcr" => 1, "unique_count" => 1, "nonunique_count" => 1,
        "source_count_type" => %w[NR NT],
      },]
      path = write_json("pipeline_output" => { "taxon_counts_attributes" => attrs })
      allow(low_pr).to receive(:generate_aggregate_counts)
      allow(low_pr).to receive(:update_names)
      allow(low_pr).to receive(:update_genera)
      allow(low_pr).to receive(:update_is_phage)
      allow(Open3).to receive(:capture3).and_return(["", "", instance_double(Process::Status)])
      low_pr.load_taxons(path, false)
      tc = low_pr.taxon_counts.find_by(tax_id: 573)
      expect(tc).to be_present
      expect(tc.source_count_type).to eq("NT-NR")
      expect(low_pr).to have_received(:update_genera)
    end

    it "appends '+' to count_type and calls update_superkingdoms for refined multihit loads" do
      attrs = [{
        "tax_id" => 573, "tax_level" => 1, "count_type" => "NT", "count" => 100,
        "percent_identity" => 95.0, "alignment_length" => 100, "e_value" => -10,
        "family_taxid" => 570, "source_count_type" => nil,
      },]
      path = write_json("pipeline_output" => { "taxon_counts_attributes" => attrs })
      # PIN: the refined (refined: true) path appends "+" to count_type ("NT" -> "NT+"),
      # but "NT+" is NOT in TaxonCount's count_type inclusion list (app/models/taxon_count.rb:49).
      # A validating import! would therefore reject it. We stub import! to isolate the
      # branch under test (the multihit? => update_superkingdoms arm) and capture the
      # mutated attrs to assert the "+" append happened. This does NOT assert prod-path
      # validity of "NT+"; see characterization note in the PR body.
      imported = nil
      allow(TaxonCount).to receive(:import!) { |arr| imported = arr }
      allow(pr).to receive(:update_names)
      allow(pr).to receive(:update_superkingdoms)
      allow(pr).to receive(:update_is_phage)
      allow(Open3).to receive(:capture3).and_return(["", "", instance_double(Process::Status)])
      pr.load_taxons(path, true)
      expect(imported.first["count_type"]).to eq("NT+")
      expect(pr).to have_received(:update_superkingdoms)
    end
  end

  # ---------------------------------------------------------------------------
  # #db_load_taxon_counts — download-fail vs success
  # ---------------------------------------------------------------------------
  describe "#db_load_taxon_counts" do
    let(:pr) { create(:pipeline_run, sample: sample, pipeline_version: "6.0.0") }

    it "logs and returns when the download fails" do
      allow(PipelineRun).to receive(:download_file_with_retries).and_return(nil)
      expect(LogUtil).to receive(:log_error).with(/failed taxon_counts download/, anything)
      expect(pr).not_to receive(:load_taxons)
      expect(pr.db_load_taxon_counts).to be_nil
    end

    it "delegates to load_taxons on a successful download" do
      allow(PipelineRun).to receive(:download_file_with_retries).and_return("/tmp/x.json")
      expect(pr).to receive(:load_taxons).with("/tmp/x.json", false)
      pr.db_load_taxon_counts
    end
  end

  # ---------------------------------------------------------------------------
  # #db_load_contig_counts
  # ---------------------------------------------------------------------------
  describe "#db_load_contig_counts" do
    let(:pr) { create(:pipeline_run, sample: sample, pipeline_version: "6.0.0") }

    it "extracts species-level contig2taxid and delegates to db_load_contigs" do
      json = [
        { "tax_level" => TaxonCount::TAX_LEVEL_SPECIES, "count_type" => "NT", "taxid" => 573, "contig_counts" => { "contig_1" => 4 } },
        { "tax_level" => TaxonCount::TAX_LEVEL_GENUS, "count_type" => "NT", "taxid" => 570, "contig_counts" => { "contig_1" => 4 } },
      ]
      path = Rails.root.join("tmp", "cc_#{SecureRandom.hex(4)}.json").to_s
      File.write(path, json.to_json)
      allow(PipelineRun).to receive(:download_file_with_retries).and_return(path)
      expected_arg = { "contig_1" => { "NT" => 573 } }
      expect(pr).to receive(:db_load_contigs).with(expected_arg)
      pr.db_load_contig_counts
    end
  end

  # ---------------------------------------------------------------------------
  # #db_load_contigs — early return on empty stats
  # ---------------------------------------------------------------------------
  describe "#db_load_contigs early return" do
    let(:pr) { create(:pipeline_run, sample: sample, pipeline_version: "6.0.0") }

    it "returns early when the contig stats json is empty" do
      stats_path = Rails.root.join("tmp", "cstats_#{SecureRandom.hex(4)}.json").to_s
      File.write(stats_path, "{}")
      allow(PipelineRun).to receive(:download_file_with_retries).and_return(stats_path)
      expect(pr.db_load_contigs({})).to be_nil
      expect(pr.contigs).to be_empty
    end
  end

  # ---------------------------------------------------------------------------
  # #check_and_enqueue — every branch of the enqueue state machine
  # ---------------------------------------------------------------------------
  describe "#check_and_enqueue" do
    let(:pr) { create(:pipeline_run, sample: sample, pipeline_version: "6.0.0") }

    it "does nothing when the output state is not UNKNOWN/LOADING_ERROR" do
      os = pr.output_states.first
      os.update!(state: PipelineRun::STATUS_LOADED)
      expect(Resque).not_to receive(:enqueue)
      pr.check_and_enqueue(os)
    end

    it "enqueues a loader when the output is ready" do
      os = pr.output_states.first
      os.update!(state: PipelineRun::STATUS_UNKNOWN)
      allow(pr).to receive(:output_ready?).and_return(true)
      expect(Resque).to receive(:enqueue).with(ResultMonitorLoader, pr.id, os.output)
      pr.check_and_enqueue(os)
      expect(os.reload.state).to eq(PipelineRun::STATUS_LOADING_QUEUED)
    end

    it "marks FAILED when output should have been generated and has no checker" do
      os = pr.output_states.find_by(output: "taxon_counts")
      os.update!(state: PipelineRun::STATUS_UNKNOWN)
      allow(pr).to receive(:output_ready?).and_return(false)
      allow(pr).to receive(:finalized?).and_return(true)
      pr.update_column(:updated_at, 2.minutes.ago)
      allow(LogUtil).to receive(:log_error)
      pr.check_and_enqueue(os)
      expect(os.reload.state).to eq(PipelineRun::STATUS_FAILED)
    end

    it "marks LOADED when a checker says the output should NOT have been generated" do
      os = pr.output_states.find_by(output: "insert_size_metrics")
      os.update!(state: PipelineRun::STATUS_UNKNOWN)
      allow(pr).to receive(:output_ready?).and_return(false)
      allow(pr).to receive(:finalized?).and_return(true)
      pr.update_column(:updated_at, 2.minutes.ago)
      allow(pr).to receive(:should_have_insert_size_metrics).and_return(false)
      pr.check_and_enqueue(os)
      expect(os.reload.state).to eq(PipelineRun::STATUS_LOADED)
    end

    it "does nothing when not ready and not (should_be_available or notifications enabled)" do
      os = pr.output_states.first
      os.update!(state: PipelineRun::STATUS_UNKNOWN)
      allow(pr).to receive(:output_ready?).and_return(false)
      allow(pr).to receive(:finalized?).and_return(false)
      allow(AppConfigHelper).to receive(:get_app_config).with(AppConfig::ENABLE_SFN_NOTIFICATIONS).and_return("0")
      expect(Resque).not_to receive(:enqueue)
      pr.check_and_enqueue(os)
      expect(os.reload.state).to eq(PipelineRun::STATUS_UNKNOWN)
    end
  end

  # ---------------------------------------------------------------------------
  # #monitor_results
  # ---------------------------------------------------------------------------
  describe "#monitor_results" do
    it "returns early when results are already finalized" do
      pr = create(:pipeline_run, sample: sample, results_finalized: PipelineRun::FINALIZED_SUCCESS)
      expect(pr).not_to receive(:update_job_stats)
      pr.monitor_results
    end

    # PIN (characterization): the guard is `return if pipeline_version.blank? && !finalized`
    # (app/models/pipeline_run.rb:1134). `finalized` is the raw integer column, and 0 is
    # TRUTHY in Ruby, so `!finalized` is false whenever finalized == 0 — the guard NEVER
    # fires for the common "not finalized (0), no version yet" case, and the method
    # proceeds to update_job_stats. (Compare finalized? which correctly means finalized == 1.)
    # This documents current behavior; it is not asserting the guard is correct.
    it "does NOT return early for a blank-version, finalized==0 run (0 is truthy)" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: nil, finalized: 0)
      allow(pr).to receive(:update_pipeline_version)
      allow(pr).to receive(:check_and_enqueue)
      allow(pr).to receive(:all_output_states_terminal?).and_return(false)
      expect(pr).to receive(:update_job_stats).and_return(nil)
      pr.monitor_results
    end

    it "returns early when pipeline_version is blank and finalized is nil (truly not finalized)" do
      # The finalized column is NOT NULL at the DB level, so the only way the
      # `!finalized` early-return arm can fire is a nil at the Ruby level. Stub it
      # to drive that (otherwise unreachable-from-a-real-row) branch.
      pr = create(:pipeline_run, sample: sample, pipeline_version: nil)
      allow(pr).to receive(:finalized).and_return(nil)
      allow(pr).to receive(:update_pipeline_version)
      expect(pr).not_to receive(:update_job_stats)
      pr.monitor_results
    end

    it "checks outputs and finalizes when all states are terminal" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "6.0.0")
      pr.output_states.update_all(state: PipelineRun::STATUS_LOADED)
      allow(pr).to receive(:update_job_stats).and_return(nil)
      allow(pr).to receive(:check_and_enqueue)
      expect(pr).to receive(:finalize_results).with(nil)
      pr.monitor_results
    end
  end

  # ---------------------------------------------------------------------------
  # #load_stage_results
  # ---------------------------------------------------------------------------
  describe "#load_stage_results" do
    it "returns early when results are finalized" do
      pr = create(:pipeline_run, sample: sample, results_finalized: PipelineRun::FINALIZED_FAIL)
      expect(pr).not_to receive(:update_job_stats)
      pr.load_stage_results(PipelineRunStage::DAG_NAME_HOST_FILTER)
    end

    it "compiles stats for the host-filter stage and finalizes when terminal" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "6.0.0")
      pr.output_states.update_all(state: PipelineRun::STATUS_LOADED)
      allow(pr).to receive(:check_and_enqueue)
      allow(pr).to receive(:update_job_stats).and_return(nil)
      allow(pr).to receive(:check_job_stats).and_return(nil)
      expect(pr).to receive(:finalize_results)
      pr.load_stage_results(PipelineRunStage::DAG_NAME_HOST_FILTER)
    end

    it "logs when compiling stats returns an error for the postprocess stage" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "6.0.0")
      allow(pr).to receive(:check_and_enqueue)
      allow(pr).to receive(:update_job_stats).and_return("boom")
      allow(pr).to receive(:all_output_states_terminal?).and_return(false)
      expect(LogUtil).to receive(:log_error).with(/Failure compiling stats/)
      pr.load_stage_results(PipelineRunStage::DAG_NAME_POSTPROCESS)
    end
  end

  # ---------------------------------------------------------------------------
  # #update_job_stats — success and rescue arms
  # ---------------------------------------------------------------------------
  describe "#update_job_stats" do
    let(:pr) { create(:pipeline_run, sample: sample, pipeline_version: "6.0.0") }

    it "returns nil on success" do
      allow(MngsReadsStatsLoadService).to receive(:call)
      allow(pr).to receive(:load_qc_percent)
      allow(pr).to receive(:load_compression_ratio)
      expect(pr.update_job_stats).to be_nil
    end

    it "logs and returns the error object when a StandardError is raised" do
      err = StandardError.new("stats failed")
      allow(MngsReadsStatsLoadService).to receive(:call).and_raise(err)
      expect(LogUtil).to receive(:log_error).with(/Failure compiling stats/, hash_including(:exception))
      expect(pr.update_job_stats).to eq(err)
    end
  end

  # ---------------------------------------------------------------------------
  # #finalize_results — success vs fail arm
  # ---------------------------------------------------------------------------
  describe "#finalize_results" do
    # A successful Illumina finalize also queues heatmap indexing (HeatmapIndexing.enqueue, covered in
    # pipeline_run_spec); stubbed here so these examples assert only the precache arm.
    before { allow(HeatmapIndexing).to receive(:enqueue) }

    it "marks FINALIZED_SUCCESS and precaches when ready_for_cache?" do
      pr = create(:pipeline_run, sample: sample, executed_at: 1.hour.ago, job_status: PipelineRun::STATUS_CHECKED)
      pr.output_states.update_all(state: PipelineRun::STATUS_LOADED)
      allow(pr).to receive(:ready_for_cache?).and_return(true)
      allow(MetricUtil).to receive(:log_analytics_event)
      expect(Resque).to receive(:enqueue).with(PrecacheReportInfo, pr.id)
      pr.finalize_results(nil)
      expect(pr.reload.results_finalized).to eq(PipelineRun::FINALIZED_SUCCESS)
    end

    it "does NOT enqueue precache when not ready_for_cache? but still succeeds" do
      pr = create(:pipeline_run, sample: sample, executed_at: 1.hour.ago)
      pr.output_states.update_all(state: PipelineRun::STATUS_LOADED)
      allow(pr).to receive(:ready_for_cache?).and_return(false)
      allow(MetricUtil).to receive(:log_analytics_event)
      expect(Resque).not_to receive(:enqueue)
      pr.finalize_results(nil)
      expect(pr.reload.results_finalized).to eq(PipelineRun::FINALIZED_SUCCESS)
    end

    it "marks FINALIZED_FAIL when a compiling stats error is present" do
      pr = create(:pipeline_run, sample: sample, executed_at: 1.hour.ago)
      pr.output_states.update_all(state: PipelineRun::STATUS_LOADED)
      allow(MetricUtil).to receive(:log_analytics_event)
      pr.finalize_results("some error")
      expect(pr.reload.results_finalized).to eq(PipelineRun::FINALIZED_FAIL)
    end

    it "marks FINALIZED_FAIL when not all outputs loaded" do
      pr = create(:pipeline_run, sample: sample, executed_at: 1.hour.ago)
      pr.output_states.first.update!(state: PipelineRun::STATUS_FAILED)
      allow(MetricUtil).to receive(:log_analytics_event)
      pr.finalize_results(nil)
      expect(pr.reload.results_finalized).to eq(PipelineRun::FINALIZED_FAIL)
    end
  end

  # ---------------------------------------------------------------------------
  # #check_job_stats
  # ---------------------------------------------------------------------------
  describe "#check_job_stats" do
    let(:pr) { create(:pipeline_run, sample: sample, pipeline_version: "6.0.0") }

    it "returns nil when there is no stats file" do
      allow(S3Util).to receive(:get_s3_file).and_return(nil)
      expect(pr.check_job_stats).to be_nil
    end

    it "returns nil when all job stats are loaded" do
      create(:job_stat, pipeline_run: pr, task: "star_out")
      allow(S3Util).to receive(:get_s3_file).and_return([{ "task" => "star_out" }].to_json)
      expect(pr.check_job_stats).to be_nil
    end

    it "returns an error string when job stats are missing" do
      allow(S3Util).to receive(:get_s3_file).and_return([{ "task" => "star_out" }, { "task" => "missing_task" }].to_json)
      allow(LogUtil).to receive(:log_error)
      expect(pr.check_job_stats).to match(/failed to load job stats/)
    end
  end

  # ---------------------------------------------------------------------------
  # #dispatch
  # ---------------------------------------------------------------------------
  describe "#dispatch" do
    it "updates the arn/version on a successful illumina dispatch" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      allow(SfnPipelineDispatchService).to receive(:call).and_return(sfn_execution_arn: "arn:new", pipeline_version: "6.1.0")
      pr.dispatch
      expect(pr.reload.sfn_execution_arn).to eq("arn:new")
      expect(pr.pipeline_version).to eq("6.1.0")
    end

    it "uses the long-read service for nanopore" do
      ont = create(:sample, project: project, user: @joe)
      pr = create(:pipeline_run, sample: ont, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      allow(SfnLongReadMngsPipelineDispatchService).to receive(:call).and_return(sfn_execution_arn: "arn:ont", pipeline_version: "1.0.0")
      pr.dispatch
      expect(pr.reload.sfn_execution_arn).to eq("arn:ont")
    end

    it "marks the run FAILED/finalized when dispatch yields a blank arn" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina], executed_at: 1.hour.ago)
      allow(SfnPipelineDispatchService).to receive(:call).and_return({})
      pr.dispatch
      expect(pr.reload.job_status).to eq(PipelineRun::STATUS_FAILED)
      expect(pr.finalized).to eq(1)
    end

    it "logs and finalizes FAILED when the dispatch service raises" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina], executed_at: 1.hour.ago)
      allow(SfnPipelineDispatchService).to receive(:call).and_raise(StandardError.new("dispatch boom"))
      expect(LogUtil).to receive(:log_error).with(/Error starting SFN pipeline/, hash_including(:exception))
      pr.dispatch
      expect(pr.reload.job_status).to eq(PipelineRun::STATUS_FAILED)
    end
  end

  # ---------------------------------------------------------------------------
  # Version-dependent path derivations — legacy (DAG / non-step-function) arms
  # that the step-function-only coverage spec never touches.
  # ---------------------------------------------------------------------------
  describe "legacy DAG path derivations" do
    let(:pr) do
      create(:pipeline_run, sample: sample, pipeline_version: "3.5",
                            pipeline_execution_strategy: PipelineRun.pipeline_execution_strategies[:directed_acyclic_graph])
    end

    it "#postprocess_output_s3_path builds a version-suffixed sample path" do
      expect(pr.postprocess_output_s3_path).to include(sample.sample_postprocess_s3_path)
      expect(pr.postprocess_output_s3_path).to include("3.5")
    end

    it "#expt_output_s3_path builds a version-suffixed expt path" do
      expect(pr.expt_output_s3_path).to include(sample.sample_expt_s3_path)
    end

    it "#assembly_s3_path appends /assembly for DAG runs" do
      expect(pr.assembly_s3_path).to end_with("/assembly")
    end

    it "#alignment_viz_output_s3_path appends align_viz for DAG runs" do
      expect(pr.alignment_viz_output_s3_path).to end_with("/align_viz")
    end

    it "#coverage_viz_output_s3_path appends coverage_viz for DAG runs" do
      expect(pr.coverage_viz_output_s3_path).to end_with("/coverage_viz")
    end

    it "#host_filter_output_s3_path returns the versioned output path for DAG runs" do
      expect(pr.host_filter_output_s3_path).to eq(pr.output_s3_path_with_version)
    end

    it "#output_s3_path_with_version includes the pipeline version for DAG runs" do
      expect(pr.output_s3_path_with_version).to include("/3.5")
    end

    it "#output_s3_path_with_version falls back to the bare sample path when version is nil" do
      no_ver = create(:pipeline_run, sample: sample, pipeline_version: nil,
                                     pipeline_execution_strategy: PipelineRun.pipeline_execution_strategies[:directed_acyclic_graph])
      expect(no_ver.output_s3_path_with_version).to eq(sample.sample_output_s3_path)
    end

    it "#alignment_output_s3_path chomps the trailing slash" do
      expect(pr.alignment_output_s3_path).not_to end_with("/")
    end
  end

  # ---------------------------------------------------------------------------
  # #subsample_suffix — all three arms
  # ---------------------------------------------------------------------------
  describe "#subsample_suffix" do
    it "returns nil for new dag pipelines (>= v2)" do
      pr = build(:pipeline_run, sample: sample, pipeline_version: "6.0.0")
      expect(pr.subsample_suffix).to be_nil
    end

    it "returns subsample_<n> for old versioned runs with a subsample" do
      pr = build(:pipeline_run, sample: sample, pipeline_version: "1.0", subsample: 1000)
      expect(pr.subsample_suffix).to eq("subsample_1000")
    end

    it "returns subsample_all for old versioned runs without a subsample" do
      pr = build(:pipeline_run, sample: sample, pipeline_version: "1.0", subsample: nil)
      expect(pr.subsample_suffix).to eq("subsample_all")
    end

    it "returns an empty suffix when there is no version and no subsample" do
      pr = build(:pipeline_run, sample: sample, pipeline_version: nil, subsample: nil)
      expect(pr.subsample_suffix).to eq("")
    end
  end

  # ---------------------------------------------------------------------------
  # #annotated_fasta_s3_path / #unidentified_fasta_s3_path — legacy arms
  # ---------------------------------------------------------------------------
  describe "fasta path legacy arms" do
    it "#annotated_fasta_s3_path uses the postprocess path for v2 non-assembly runs" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "2.5",
                                 pipeline_execution_strategy: PipelineRun.pipeline_execution_strategies[:directed_acyclic_graph])
      allow(pr).to receive(:supports_assembly?).and_return(false)
      expect(pr.annotated_fasta_s3_path).to include(PipelineRun::DAG_ANNOTATED_FASTA_BASENAME)
    end

    it "#annotated_fasta_s3_path uses the HIT basename for v6+ pre-v2-branch runs" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "1.6",
                                 pipeline_execution_strategy: PipelineRun.pipeline_execution_strategies[:directed_acyclic_graph])
      allow(pr).to receive(:supports_assembly?).and_return(false)
      allow(pr).to receive(:pipeline_version_at_least_2).and_return(false)
      allow(pr).to receive(:pipeline_version_at_least).with(anything, "6.0.0").and_return(true)
      allow(pr).to receive(:multihit?).and_return(false)
      expect(pr.annotated_fasta_s3_path).to include(PipelineRun::HIT_FASTA_BASENAME)
    end

    it "#annotated_fasta_s3_path uses the CDHITDUP basename for old multihit runs" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "1.6",
                                 pipeline_execution_strategy: PipelineRun.pipeline_execution_strategies[:directed_acyclic_graph])
      allow(pr).to receive(:supports_assembly?).and_return(false)
      allow(pr).to receive(:pipeline_version_at_least_2).and_return(false)
      allow(pr).to receive(:pipeline_version_at_least).with(anything, "6.0.0").and_return(false)
      allow(pr).to receive(:multihit?).and_return(true)
      expect(pr.annotated_fasta_s3_path).to include(PipelineRun::MULTIHIT_FASTA_BASENAME)
    end

    it "#unidentified_fasta_s3_path uses the alignment path for legacy runs" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "1.6",
                                 pipeline_execution_strategy: PipelineRun.pipeline_execution_strategies[:directed_acyclic_graph])
      allow(pr).to receive(:supports_assembly?).and_return(false)
      allow(pr).to receive(:pipeline_version_at_least_2).and_return(false)
      expect(pr.unidentified_fasta_s3_path).to include(PipelineRun::UNIDENTIFIED_FASTA_BASENAME)
    end
  end

  # ---------------------------------------------------------------------------
  # #assembly? / #coverage_viz_data_s3_path
  # ---------------------------------------------------------------------------
  describe "#assembly?" do
    it "is false for realistic versions (the giant guard version)" do
      expect(build(:pipeline_run, sample: sample, pipeline_version: "8.0").assembly?).to be_falsy
    end
  end

  describe "#coverage_viz_data_s3_path" do
    it "returns a path for coverage-viz-enabled versions" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "6.0.0",
                                 sfn_execution_arn: "arn", s3_output_prefix: "s3://p", wdl_version: "6.0")
      expect(pr.coverage_viz_data_s3_path("ACC1")).to include("ACC1_coverage_viz.json")
    end

    it "returns nil for old illumina versions without coverage viz" do
      pr = build(:pipeline_run, sample: sample, pipeline_version: "1.0",
                                technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      expect(pr.coverage_viz_data_s3_path("ACC1")).to be_nil
    end
  end

  # ---------------------------------------------------------------------------
  # #contig_lineages / #get_contigs_for_taxid / #summary_contig_counts
  # ---------------------------------------------------------------------------
  describe "contig lineage queries" do
    let(:pr) { create(:pipeline_run, sample: sample, pipeline_version: "6.0.0") }

    it "#contig_lineages returns only contigs with a non-null lineage_json" do
      create(:contig, pipeline_run: pr, name: "c1", lineage_json: { "NT" => [573] }.to_json)
      # lineage_json has a presence validation, so null the column directly to
      # exercise the "WHERE lineage_json IS NOT NULL" filter.
      c2 = create(:contig, pipeline_run: pr, name: "c2", lineage_json: "{}")
      c2.update_column(:lineage_json, nil)
      expect(pr.contig_lineages.length).to eq(1)
    end

    it "#get_contigs_for_taxid matches NT-only lineage entries" do
      create(:contig, pipeline_run: pr, name: "c1", read_count: 5, lineage_json: { "NT" => [573, 570] }.to_json)
      create(:contig, pipeline_run: pr, name: "c2", read_count: 3, lineage_json: { "NR" => [999] }.to_json)
      result = pr.get_contigs_for_taxid(573, "NT")
      expect(result.pluck(:name)).to eq(["c1"])
    end

    it "#get_contigs_for_taxid matches NR-only lineage entries" do
      create(:contig, pipeline_run: pr, name: "c2", read_count: 3, lineage_json: { "NR" => [999] }.to_json)
      expect(pr.get_contigs_for_taxid(999, "NR").pluck(:name)).to eq(["c2"])
    end

    it "#get_contigs_for_taxid matches across all dbs for nt_and_nr" do
      create(:contig, pipeline_run: pr, name: "c3", read_count: 7, lineage_json: { "NT" => [111], "NR" => [222] }.to_json)
      expect(pr.get_contigs_for_taxid(222).pluck(:name)).to eq(["c3"])
    end

    it "#summary_contig_counts tallies by species and genus taxids (illumina => read_count key)" do
      create(:contig, pipeline_run: pr, name: "c1", read_count: 4,
                      species_taxid_nt: 573, species_taxid_nr: nil, genus_taxid_nt: 570,
                      lineage_json: { "NT" => [573] }.to_json)
      summary = pr.summary_contig_counts
      expect(summary[573]["nt"][4]).to eq(1)
      expect(summary[570]["nt"][4]).to eq(1)
    end
  end

  # ---------------------------------------------------------------------------
  # #compare_ercc_counts non-empty arm
  # ---------------------------------------------------------------------------
  describe "#compare_ercc_counts with counts" do
    it "returns a baseline comparison including actual counts" do
      pr = create(:pipeline_run, sample: sample)
      baseline = ErccCount::BASELINE.first
      ErccCount.create!(pipeline_run: pr, name: baseline[:ercc_id], count: 42)
      result = pr.compare_ercc_counts
      matched = result.find { |r| r[:name] == baseline[:ercc_id] }
      expect(matched[:actual]).to eq(42)
    end
  end

  # ---------------------------------------------------------------------------
  # #bases_before_and_after_subsampling
  # ---------------------------------------------------------------------------
  describe "#bases_before_and_after_subsampling" do
    it "plucks bases_after for the human_filtered and subsampled tasks" do
      pr = create(:pipeline_run, sample: sample)
      create(:job_stat, pipeline_run: pr, task: "human_filtered_bases", bases_after: 100)
      create(:job_stat, pipeline_run: pr, task: "subsampled_bases", bases_after: 50)
      create(:job_stat, pipeline_run: pr, task: "other", bases_after: 999)
      expect(pr.bases_before_and_after_subsampling).to match_array([100, 50])
    end
  end

  # ---------------------------------------------------------------------------
  # #precache_report_info! — nanopore (no backgrounds) vs illumina (backgrounds)
  # ---------------------------------------------------------------------------
  describe "#precache_report_info!" do
    it "precaches once without backgrounds for nanopore" do
      ont = create(:sample, project: project, user: @joe)
      pr = create(:pipeline_run, sample: ont, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore], pipeline_version: "1.0")
      allow(PipelineReportService).to receive(:report_info_cache_key).and_return("key")
      allow(Rails.cache).to receive(:fetch)
      allow(MetricUtil).to receive(:log_analytics_event)
      pr.precache_report_info!
      expect(MetricUtil).to have_received(:log_analytics_event).once
    end

    it "precaches per background for illumina" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina], pipeline_version: "6.0.0")
      allow(Background).to receive(:top_for_sample).and_return(double(pluck: [1, 2]))
      allow(PipelineReportService).to receive(:report_info_cache_key).and_return("key")
      allow(Rails.cache).to receive(:fetch)
      allow(MetricUtil).to receive(:log_analytics_event)
      pr.precache_report_info!
      expect(MetricUtil).to have_received(:log_analytics_event).twice
    end
  end

  # ---------------------------------------------------------------------------
  # #self.download_file_with_retries / #self.download_file
  # ---------------------------------------------------------------------------
  describe ".download_file / .download_file_with_retries" do
    it "returns the destination path when s3_cp succeeds (dest is dir)" do
      allow(Syscall).to receive(:run)
      allow(Syscall).to receive(:s3_cp).and_return(true)
      result = PipelineRun.download_file("s3://b/k/file.json", "/tmp/dir")
      expect(result).to eq("/tmp/dir/file.json")
    end

    it "returns nil when s3_cp fails" do
      allow(Syscall).to receive(:run)
      allow(Syscall).to receive(:s3_cp).and_return(false)
      expect(PipelineRun.download_file("s3://b/k/file.json", "/tmp/dir")).to be_nil
    end

    it "treats the destination as a file path when dest_is_dir is false" do
      allow(Syscall).to receive(:s3_cp).and_return(true)
      expect(Syscall).not_to receive(:run)
      expect(PipelineRun.download_file("s3://b/k/f.json", "/tmp/exact.json", false)).to eq("/tmp/exact.json")
    end

    it "retries download_file until it succeeds" do
      call_count = 0
      allow(PipelineRun).to receive(:download_file) do
        call_count += 1
        call_count >= 2 ? "/tmp/ok" : nil
      end
      allow(PipelineRun).to receive(:sleep)
      expect(PipelineRun.download_file_with_retries("s3://b/k", "/tmp", 3)).to eq("/tmp/ok")
      expect(call_count).to eq(2)
    end

    it "returns nil (falls through) after exhausting retries" do
      allow(PipelineRun).to receive(:download_file).and_return(nil)
      allow(PipelineRun).to receive(:sleep)
      expect(PipelineRun.download_file_with_retries("s3://b/k", "/tmp", 2)).to be_nil
    end
  end

  # ---------------------------------------------------------------------------
  # #sfn_pipeline_error non-nil arm + #input_error
  # ---------------------------------------------------------------------------
  describe "#sfn_pipeline_error with an output path" do
    it "returns the [error_type, error_cause] tuple from SfnExecution" do
      pr = create(:pipeline_run, sample: sample, sfn_execution_arn: "arn", s3_output_prefix: "s3://p", wdl_version: "6.0")
      fake = instance_double(SfnExecution, pipeline_error: ["ERR", "cause text"])
      allow(SfnExecution).to receive(:new).and_return(fake)
      expect(pr.sfn_pipeline_error).to eq(["ERR", "cause text"])
    end
  end

  # ---------------------------------------------------------------------------
  # #outputs_by_step DAG routing (branch not taken by the sfn-only spec)
  # ---------------------------------------------------------------------------
  describe "#outputs_by_step DAG routing" do
    it "routes to dag_outputs_by_step for directed_acyclic_graph runs" do
      pr = create(:pipeline_run, sample: sample,
                                 pipeline_execution_strategy: PipelineRun.pipeline_execution_strategies[:directed_acyclic_graph])
      allow(pr).to receive(:step_function?).and_return(false)
      allow(pr).to receive(:dag_outputs_by_step).and_return({ dag: true })
      expect(pr.outputs_by_step).to eq({ dag: true })
    end
  end

  # ---------------------------------------------------------------------------
  # #sfn_outputs_by_step technology routing
  # ---------------------------------------------------------------------------
  describe "#sfn_outputs_by_step technology routing" do
    it "routes illumina to illumina_sfn_outputs_by_step" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      allow(pr).to receive(:illumina_sfn_outputs_by_step).and_return({ illumina: true })
      expect(pr.sfn_outputs_by_step(true)).to eq({ illumina: true })
    end

    it "routes nanopore to ont_sfn_outputs_by_step" do
      ont = create(:sample, project: project, user: @joe)
      pr = create(:pipeline_run, sample: ont, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      allow(pr).to receive(:ont_sfn_outputs_by_step).and_return({ ont: true })
      expect(pr.sfn_outputs_by_step).to eq({ ont: true })
    end
  end

  # ---------------------------------------------------------------------------
  # #call_pipeline_data_service technology routing
  # ---------------------------------------------------------------------------
  describe "#call_pipeline_data_service" do
    it "calls SfnPipelineDataService for illumina" do
      pr = create(:pipeline_run, sample: sample, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      expect(SfnPipelineDataService).to receive(:call).with(pr.id, true, false)
      pr.call_pipeline_data_service(true, false)
    end

    it "calls SfnSingleStagePipelineDataService for nanopore" do
      ont = create(:sample, project: project, user: @joe)
      pr = create(:pipeline_run, sample: ont, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      expect(SfnSingleStagePipelineDataService).to receive(:call).with(pr.id, PipelineRun::TECHNOLOGY_INPUT[:nanopore], true)
      pr.call_pipeline_data_service(false, true)
    end
  end

  # ---------------------------------------------------------------------------
  # #host_subtracted (ercc_only branch) covered in the base spec; here we drive
  # #get_m8_mapping to lock in file-parsing behavior.
  # ---------------------------------------------------------------------------
  describe "#get_m8_mapping" do
    it "parses an m8 file into a header-keyed hash" do
      pr = create(:pipeline_run, sample: sample, pipeline_version: "6.0.0")
      m8_path = Rails.root.join("tmp", "m8_#{SecureRandom.hex(4)}.m8").to_s
      File.write(m8_path, "contig_1\tACC1\t95.0\t100\n")
      allow(PipelineRun).to receive(:download_file_with_retries).and_return(m8_path)
      mapping = pr.get_m8_mapping(PipelineRun::CONTIG_NT_TOP_M8)
      expect(mapping["contig_1"]).to eq(["contig_1", "ACC1", "95.0", "100"])
    end
  end

  # ---------------------------------------------------------------------------
  # #completed? falsy return arm (implicit nil)
  # ---------------------------------------------------------------------------
  describe "#completed? implicit nil" do
    it "returns nil for a non-finalized run that has stages" do
      pr = create(:pipeline_run, sample: sample, finalized: 0,
                                 pipeline_run_stages_data: [{ step_number: 1, job_status: PipelineRunStage::STATUS_STARTED }])
      expect(pr.completed?).to be_nil
    end
  end
end

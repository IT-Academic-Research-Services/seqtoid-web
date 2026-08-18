require "rails_helper"

# Fourth branch sweep for Sample. The existing companions (sample_spec,
# sample_branches_spec, sample_coverage{,2,3}_spec, sample_scopes_branches_spec)
# cover the scopes, the s3 path helpers, metadata and the guard arms of
# kickoff_pipeline / transfer_basespace_fastq_files. The arms still untaken:
#   - kickoff_pipeline's successful-save body: the subsample / max_input_fragments
#     / pipeline_branch defaults (both sides of each ||), the `if dag_vars` fork,
#     the admin-supplied vs VersionRetrievalService alignment config, and the
#     ENABLE_SFN_NOTIFICATIONS dispatch gate (on with a fresh stage 1, on with a
#     stage that is already started, and off).
#   - transfer_basespace_fastq_files' multi-lane concat path (should_concat_lanes
#     true, and the dataset_index != 0 append arm).
#   - the contig-threshold arel builders: both `metric` cases and both operators.
#   - first_workflow_run, pipeline_runs_info, workflow_runs_info.
RSpec.describe Sample, type: :model do
  create_users

  let(:project) { create(:project, users: [@joe]) }
  let(:illumina) { PipelineRun::TECHNOLOGY_INPUT[:illumina] }

  describe "#kickoff_pipeline" do
    before do
      create(:alignment_config, name: AlignmentConfig.default_name)
      allow(Sample).to receive(:pipeline_commit).and_return("abc123")
      allow(VersionRetrievalService).to receive(:call).and_return(AlignmentConfig.default_name)
      allow(AppConfigHelper).to receive(:get_app_config).and_call_original
      allow(AppConfigHelper).to receive(:get_app_config)
        .with(AppConfig::ENABLE_SFN_NOTIFICATIONS).and_return("0")
    end

    it "falls back to the pipeline defaults when the sample sets no overrides" do
      sample = create(:sample, project: project, user: @joe,
                               subsample: nil, max_input_fragments: nil,
                               pipeline_branch: nil, dag_vars: nil, alignment_config_name: nil)

      sample.kickoff_pipeline
      pr = sample.pipeline_runs.reload.first

      expect(pr).to be_present
      expect(pr.subsample).to eq(PipelineRun::DEFAULT_SUBSAMPLING)
      expect(pr.max_input_fragments).to eq(PipelineRun::DEFAULT_MAX_INPUT_FRAGMENTS)
      expect(pr.pipeline_branch).to eq("master")
      expect(pr.dag_vars).to be_nil
      expect(pr.technology).to eq(illumina)
      expect(pr.pipeline_commit).to eq("abc123")
      # no admin override -> the pinned project config was resolved
      expect(VersionRetrievalService).to have_received(:call).with(sample.project_id, AlignmentConfig::NCBI_INDEX)
    end

    it "honors sample-level overrides for subsample, fragments, branch, dag vars and alignment config" do
      create(:alignment_config, name: "admin-pinned-config")
      sample = create(:sample, project: project, user: @joe,
                               subsample: 12_345, max_input_fragments: 999,
                               pipeline_branch: "feature-branch",
                               dag_vars: '{"foo":"bar"}',
                               alignment_config_name: "admin-pinned-config")

      sample.kickoff_pipeline
      pr = sample.pipeline_runs.reload.first

      expect(pr.subsample).to eq(12_345)
      expect(pr.max_input_fragments).to eq(999)
      expect(pr.pipeline_branch).to eq("feature-branch")
      expect(pr.dag_vars).to eq('{"foo":"bar"}')
      expect(pr.alignment_config.name).to eq("admin-pinned-config")
      # admin supplied a config, so the pinning service is never consulted
      expect(VersionRetrievalService).not_to have_received(:call)
    end

    it "deprecates the older pipeline runs once the new one saves" do
      sample = create(:sample, project: project, user: @joe)
      older = create(:pipeline_run, sample: sample, technology: illumina, finalized: 1, job_status: PipelineRun::STATUS_CHECKED)
      older.update_columns(created_at: 2.days.ago) # rubocop:disable Rails/SkipsModelValidations

      sample.kickoff_pipeline

      expect(older.reload.deprecated).to be(true)
      expect(sample.pipeline_runs.reload.order(created_at: :desc).first.deprecated).to be(false)
    end

    context "when async SFN notifications are enabled" do
      before do
        allow(AppConfigHelper).to receive(:get_app_config)
          .with(AppConfig::ENABLE_SFN_NOTIFICATIONS).and_return("1")
      end

      it "dispatches the run and starts stage 1 immediately" do
        sample = create(:sample, project: project, user: @joe)
        expect_any_instance_of(PipelineRun).to receive(:dispatch).once
        expect_any_instance_of(PipelineRunStage).to receive(:run_job).once

        sample.kickoff_pipeline

        # kickoff_pipeline swallows errors into upload_error, so assert the run
        # was created cleanly rather than only that the messages were sent.
        expect(sample.pipeline_runs.reload.count).to eq(1)
        expect(sample.reload.upload_error).to be_nil
      end

      it "does not dispatch when the first stage has already started" do
        sample = create(:sample, project: project, user: @joe)
        allow_any_instance_of(PipelineRunStage).to receive(:started?).and_return(true)
        expect_any_instance_of(PipelineRun).not_to receive(:dispatch)
        expect_any_instance_of(PipelineRunStage).not_to receive(:run_job)

        sample.kickoff_pipeline

        expect(sample.pipeline_runs.reload.count).to eq(1)
      end
    end

    it "does not dispatch at all when notifications are disabled" do
      sample = create(:sample, project: project, user: @joe)
      expect_any_instance_of(PipelineRun).not_to receive(:dispatch)

      sample.kickoff_pipeline

      expect(sample.pipeline_runs.reload.count).to eq(1)
    end
  end

  describe "#transfer_basespace_fastq_files across multiple lanes" do
    let(:sample) do
      create(:sample, project: project, user: @joe,
                      status: Sample::STATUS_CREATED, input_files: [], uploaded_from_basespace: 1)
    end

    def lane_files(lane)
      [
        { name: "sample_L00#{lane}_R1.fastq.gz", download_path: "https://dl/#{lane}/r1", source_path: "https://src/#{lane}/r1", size: 1_000 },
        { name: "sample_L00#{lane}_R2.fastq.gz", download_path: "https://dl/#{lane}/r2", source_path: "https://src/#{lane}/r2", size: 1_000 },
      ]
    end

    it "strips the lane suffix from the name and appends the later lanes' sources" do
      allow(sample).to receive(:files_for_basespace_dataset) do |dataset_id, _token|
        lane_files(dataset_id)
      end
      allow(sample).to receive(:upload_from_basespace_to_s3).and_return(true)
      allow(sample).to receive(:kickoff_pipeline)

      sample.transfer_basespace_fastq_files("1,2", "fake_token")

      expect(sample.input_files.length).to eq(2)
      # should_concat_lanes == true -> _L001 removed from the stored name
      expect(sample.input_files.map(&:name)).to eq(["sample_R1.fastq.gz", "sample_R2.fastq.gz"])
      # dataset_index != 0 -> the second lane's source is appended, comma separated
      expect(sample.input_files[0].source).to eq("https://src/1/r1,https://src/2/r1")
      expect(sample.input_files[1].source).to eq("https://src/1/r2,https://src/2/r2")
      # both lanes' download paths are handed to the uploader as one list, and
      # the concatenated object's expected size is the sum of the lane sizes
      # (SMP-1730): 1_000 + 1_000 == 2_000.
      expect(sample).to have_received(:upload_from_basespace_to_s3)
        .with(["https://dl/1/r1", "https://dl/2/r1"], anything, "sample_R1.fastq.gz", 2_000)
    end

    it "keeps the lane suffix in the name for a single dataset (should_concat_lanes false)" do
      allow(sample).to receive(:files_for_basespace_dataset).and_return(lane_files(1))
      allow(sample).to receive(:upload_from_basespace_to_s3).and_return(true)
      allow(sample).to receive(:kickoff_pipeline)

      sample.transfer_basespace_fastq_files("1", "fake_token")

      expect(sample.input_files.map(&:name)).to eq(["sample_L001_R1.fastq.gz", "sample_L001_R2.fastq.gz"])
      expect(sample.input_files[0].source).to eq("https://src/1/r1")
    end
  end

  describe ".add_aggregate_arel_node_for_contig_metric" do
    let(:base_query) { Contig.arel_table.where(Contig.arel_table[:read_count].gt(0)) }

    it "counts rows for the 'contigs' metric with a >= having clause" do
      sql = described_class.add_aggregate_arel_node_for_contig_metric(base_query, "contigs", ">=", 5).to_sql

      expect(sql).to include("COUNT(*)")
      expect(sql).to include(">= 5")
      expect(sql).to include("GROUP BY")
    end

    it "sums read_count for the 'contig_r' metric with a <= having clause" do
      sql = described_class.add_aggregate_arel_node_for_contig_metric(base_query, "contig_r", "<=", 42).to_sql

      expect(sql).to include("SUM")
      expect(sql).to include("read_count")
      expect(sql).to include("<= 42")
    end
  end

  describe ".create_contig_filter_statement" do
    it "builds a species-level NT filter joined to pipeline_runs" do
      sql = described_class.create_contig_filter_statement("contigs", 573, "species", "NT", ">=", 2)

      expect(sql).to include("species_taxid_nt")
      expect(sql).to include("573")
      expect(sql).to include("pipeline_run_id")
    end

    it "builds a genus-level NR filter with the <= operator" do
      sql = described_class.create_contig_filter_statement("contig_r", 570, "genus", "NR", "<=", 10)

      expect(sql).to include("genus_taxid_nr")
      expect(sql).to include("<= 10")
    end
  end

  describe "#first_workflow_run" do
    let(:sample) { create(:sample, project: project, user: @joe) }

    it "returns the most recently executed non-deprecated run of that workflow" do
      create(:workflow_run, sample: sample, user_id: @joe.id,
                            workflow: WorkflowRun::WORKFLOW[:consensus_genome], executed_at: 3.days.ago)
      newest = create(:workflow_run, sample: sample, user_id: @joe.id,
                                     workflow: WorkflowRun::WORKFLOW[:consensus_genome], executed_at: 1.day.ago)
      create(:workflow_run, sample: sample, user_id: @joe.id,
                            workflow: WorkflowRun::WORKFLOW[:consensus_genome], executed_at: Time.now.utc, deprecated: true)
      create(:workflow_run, sample: sample, user_id: @joe.id,
                            workflow: WorkflowRun::WORKFLOW[:amr], executed_at: Time.now.utc)

      expect(sample.first_workflow_run(WorkflowRun::WORKFLOW[:consensus_genome])).to eq(newest)
    end

    it "returns nil when the sample has no run of that workflow" do
      expect(sample.first_workflow_run(WorkflowRun::WORKFLOW[:amr])).to be_nil
    end
  end

  describe "#workflow_runs_info" do
    let(:sample) { create(:sample, project: project, user: @joe) }

    it "serializes non-deprecated, non-deleted runs with a run_finalized flag" do
      kept = create(:workflow_run, sample: sample, user_id: @joe.id,
                                   workflow: WorkflowRun::WORKFLOW[:consensus_genome],
                                   status: WorkflowRun::STATUS[:succeeded])
      create(:workflow_run, sample: sample, user_id: @joe.id,
                            workflow: WorkflowRun::WORKFLOW[:amr], deprecated: true)
      create(:workflow_run, sample: sample, user_id: @joe.id,
                            workflow: WorkflowRun::WORKFLOW[:amr], deleted_at: 1.hour.ago)

      info = sample.workflow_runs_info

      expect(info.pluck("id")).to eq([kept.id])
      expect(info.first["run_finalized"]).to be(true)
    end

    it "returns an empty list when there are no runs" do
      expect(sample.workflow_runs_info).to eq([])
    end
  end

  describe "#pipeline_runs_info" do
    let(:sample) { create(:sample, project: project, user: @joe) }

    it "returns one entry per distinct pipeline version, newest first" do
      create(:alignment_config, name: "config-a")
      config = AlignmentConfig.find_by(name: "config-a")
      older = create(:pipeline_run, sample: sample, pipeline_version: "7.0", finalized: 1,
                                    alignment_config_id: config.id, created_at: 2.days.ago)
      newer = create(:pipeline_run, sample: sample, pipeline_version: "8.0", finalized: 0,
                                    alignment_config_id: config.id, created_at: 1.day.ago)

      info = sample.pipeline_runs_info

      expect(info.pluck(:pipeline_version)).to eq(["8.0", "7.0"])
      expect(info.pluck(:id)).to eq([newer.id, older.id])
      expect(info.first[:alignment_config_name]).to eq("config-a")
      expect(info.first[:run_finalized]).to be(false)
      expect(info.last[:run_finalized]).to be(true)
    end

    it "excludes soft-deleted runs" do
      create(:alignment_config, name: "config-b")
      config = AlignmentConfig.find_by(name: "config-b")
      create(:pipeline_run, sample: sample, pipeline_version: "7.0",
                            alignment_config_id: config.id, deleted_at: 1.hour.ago)

      expect(sample.pipeline_runs_info).to eq([])
    end
  end
end

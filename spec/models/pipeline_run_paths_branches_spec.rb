require 'rails_helper'

# Coverage Wave (branch): pipeline_run_spec.rb does not exercise the version- and
# technology-gated S3-path derivations. This spec drives ONLY those branches
# (no DB writes, no AWS -- the version predicates and leaf path methods are
# stubbed) so each arm is hit and each test fails if its branch is inverted or
# removed:
#   - #ercc_output_path: new-host-filter + bowtie2 nesting (3 arms)
#   - #host_count_s3_path: new-host-filter true vs false
#   - #wdl_s3_folder: the `at_least(5.0.0) || nanopore` disjunction and the else
#   - #coverage_viz_data_s3_path: the `has_coverage_viz || nanopore` guard, both arms
#   - #sfn_output_path: the arn-blank guard, then `s3_output_prefix || sample...`
RSpec.describe PipelineRun, type: :model do
  describe "#ercc_output_path" do
    it "is the bowtie2 output when the new host-filtering stage uses bowtie2 (inner if true)" do
      pr = PipelineRun.new
      allow(pr).to receive(:pipeline_version_uses_new_host_filtering_stage).and_return(true)
      allow(pr).to receive(:pipeline_version_uses_bowtie2_to_calculate_ercc_reads).and_return(true)
      expect(pr.ercc_output_path).to eq(PipelineRun::BOWTIE2_ERCC_OUTPUT_NAME)
    end

    it "is the kallisto output when the new stage does not use bowtie2 (inner else)" do
      pr = PipelineRun.new
      allow(pr).to receive(:pipeline_version_uses_new_host_filtering_stage).and_return(true)
      allow(pr).to receive(:pipeline_version_uses_bowtie2_to_calculate_ercc_reads).and_return(false)
      expect(pr.ercc_output_path).to eq(PipelineRun::KALLISTO_ERCC_OUTPUT_NAME)
    end

    it "is the legacy ERCC output when not on the new host-filtering stage (outer else)" do
      pr = PipelineRun.new
      allow(pr).to receive(:pipeline_version_uses_new_host_filtering_stage).and_return(false)
      expect(pr.ercc_output_path).to eq(PipelineRun::ERCC_OUTPUT_NAME)
    end
  end

  describe "#host_count_s3_path" do
    before { @pr = PipelineRun.new; allow(@pr).to receive(:host_filter_output_s3_path).and_return("s3://hf") }

    it "uses the kallisto transcript-reads file on the new host-filtering stage (if arm)" do
      allow(@pr).to receive(:pipeline_version_uses_new_host_filtering_stage).and_return(true)
      expect(@pr.host_count_s3_path).to eq("s3://hf/#{PipelineRun::HOST_TRANSCRIPT_READS_OUTPUT_NAME}")
    end

    it "uses the STAR reads-per-gene file on the legacy stage (else arm)" do
      allow(@pr).to receive(:pipeline_version_uses_new_host_filtering_stage).and_return(false)
      expect(@pr.host_count_s3_path).to eq("s3://hf/#{PipelineRun::READS_PER_GENE_STAR_TAB_NAME}")
    end
  end

  describe "#wdl_s3_folder" do
    # NOTE: #workflow is a derived method (reads technology), not a settable column,
    # so it is stubbed rather than passed to .new. technology is a real column and is
    # set because wdl_s3_folder also reads it directly in the `|| nanopore` disjunct.
    it "uses the workflow-versioned folder when pipeline_version >= 5.0.0 (first disjunct)" do
      pr = PipelineRun.new(wdl_version: "6.1.0", technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      allow(pr).to receive(:workflow).and_return("short-read-mngs")
      allow(pr).to receive(:pipeline_version_at_least).and_return(true)
      expect(pr.wdl_s3_folder).to include("short-read-mngs-v6.1.0")
    end

    it "uses the workflow-versioned folder for nanopore even when < 5.0.0 (second disjunct)" do
      pr = PipelineRun.new(wdl_version: "3.2.0", technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      allow(pr).to receive(:workflow).and_return("long-read-mngs")
      allow(pr).to receive(:pipeline_version_at_least).and_return(false)
      expect(pr.wdl_s3_folder).to include("long-read-mngs-v3.2.0")
    end

    it "uses the legacy main folder for old illumina runs (else arm)" do
      pr = PipelineRun.new(wdl_version: "3.2.0", technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
      allow(pr).to receive(:workflow).and_return("short-read-mngs")
      allow(pr).to receive(:pipeline_version_at_least).and_return(false)
      expect(pr.wdl_s3_folder).to include("v3.2.0/#{WorkflowRun::WORKFLOW[:main]}")
    end
  end

  describe "#coverage_viz_data_s3_path" do
    before { @pr = PipelineRun.new; allow(@pr).to receive(:coverage_viz_output_s3_path).and_return("s3://cv") }

    it "builds the path when the pipeline version supports coverage viz (first disjunct)" do
      allow(@pr).to receive(:pipeline_version_has_coverage_viz).and_return(true)
      allow(@pr).to receive(:technology).and_return(PipelineRun::TECHNOLOGY_INPUT[:illumina])
      expect(@pr.coverage_viz_data_s3_path("ACC1")).to eq("s3://cv/ACC1_coverage_viz.json")
    end

    it "builds the path for nanopore even without coverage-viz version support (second disjunct)" do
      allow(@pr).to receive(:pipeline_version_has_coverage_viz).and_return(false)
      allow(@pr).to receive(:technology).and_return(PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      expect(@pr.coverage_viz_data_s3_path("ACC1")).to eq("s3://cv/ACC1_coverage_viz.json")
    end

    it "is nil when neither disjunct holds (guard false)" do
      allow(@pr).to receive(:pipeline_version_has_coverage_viz).and_return(false)
      allow(@pr).to receive(:technology).and_return(PipelineRun::TECHNOLOGY_INPUT[:illumina])
      expect(@pr.coverage_viz_data_s3_path("ACC1")).to be_nil
    end
  end

  describe "#sfn_output_path" do
    it "is the empty string when there is no SFN execution arn (guard true)" do
      pr = PipelineRun.new(sfn_execution_arn: nil)
      expect(pr.sfn_output_path).to eq("")
    end

    it "uses s3_output_prefix when present (first || operand)" do
      pr = PipelineRun.new(sfn_execution_arn: "arn:aws:states:::exec", s3_output_prefix: "s3://explicit/prefix")
      expect(pr.sfn_output_path).to eq("s3://explicit/prefix")
    end

    it "falls back to the delegated sample output path when the prefix is nil (|| operand)" do
      pr = PipelineRun.new(sfn_execution_arn: "arn:aws:states:::exec", s3_output_prefix: nil)
      allow(pr).to receive(:sample_output_s3_path).and_return("s3://sample/results")
      expect(pr.sfn_output_path).to eq("s3://sample/results")
    end
  end
end

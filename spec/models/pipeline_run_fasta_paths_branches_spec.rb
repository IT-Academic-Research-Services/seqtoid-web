require 'rails_helper'

# Coverage Wave (branch): pipeline_run_spec.rb does not exercise the assembly-aware
# FASTA path derivations. This spec drives ONLY those branches (no DB writes, no
# AWS -- the version/assembly predicates and leaf path methods are stubbed) so
# each arm is hit and each test fails if its branch is inverted or removed:
#   - #contigs_fasta_s3_path: supports_assembly? true (path) vs false (nil)
#   - #unidentified_fasta_s3_path: assembly, then version>=2, then legacy alignment
#   - #annotated_fasta_s3_path: assembly, then version>=2, then the 6.0.0
#     hit-fasta if/else and the multihit? ternary
RSpec.describe PipelineRun, type: :model do
  describe "#contigs_fasta_s3_path" do
    it "returns the assembled-contigs path when assembly is supported (guard true)" do
      pr = PipelineRun.new
      allow(pr).to receive(:supports_assembly?).and_return(true)
      allow(pr).to receive(:assembly_s3_path).and_return("s3://asm")
      expect(pr.contigs_fasta_s3_path).to eq("s3://asm/#{PipelineRun::ASSEMBLED_CONTIGS_NAME}")
    end

    it "is nil when assembly is not supported (guard false)" do
      pr = PipelineRun.new
      allow(pr).to receive(:supports_assembly?).and_return(false)
      expect(pr.contigs_fasta_s3_path).to be_nil
    end
  end

  describe "#unidentified_fasta_s3_path" do
    it "uses the assembly path when assembly is supported (first guard)" do
      pr = PipelineRun.new
      allow(pr).to receive(:supports_assembly?).and_return(true)
      allow(pr).to receive(:assembly_s3_path).and_return("s3://asm")
      expect(pr.unidentified_fasta_s3_path).to eq("s3://asm/#{PipelineRun::ASSEMBLY_PREFIX}#{PipelineRun::DAG_UNIDENTIFIED_FASTA_BASENAME}")
    end

    it "uses the versioned output path for pipeline version >= 2 (second guard)" do
      pr = PipelineRun.new
      allow(pr).to receive(:supports_assembly?).and_return(false)
      allow(pr).to receive(:pipeline_version_at_least_2).and_return(true)
      allow(pr).to receive(:output_s3_path_with_version).and_return("s3://ver")
      expect(pr.unidentified_fasta_s3_path).to eq("s3://ver/#{PipelineRun::DAG_UNIDENTIFIED_FASTA_BASENAME}")
    end

    it "falls back to the legacy alignment path (both guards false)" do
      pr = PipelineRun.new
      allow(pr).to receive(:supports_assembly?).and_return(false)
      allow(pr).to receive(:pipeline_version_at_least_2).and_return(false)
      allow(pr).to receive(:alignment_output_s3_path).and_return("s3://aln")
      expect(pr.unidentified_fasta_s3_path).to eq("s3://aln/#{PipelineRun::UNIDENTIFIED_FASTA_BASENAME}")
    end
  end

  describe "#annotated_fasta_s3_path" do
    it "uses the assembly path when assembly is supported (first guard)" do
      pr = PipelineRun.new
      allow(pr).to receive(:supports_assembly?).and_return(true)
      allow(pr).to receive(:assembly_s3_path).and_return("s3://asm")
      expect(pr.annotated_fasta_s3_path).to eq("s3://asm/#{PipelineRun::ASSEMBLY_PREFIX}#{PipelineRun::DAG_ANNOTATED_FASTA_BASENAME}")
    end

    it "uses the postprocess path for pipeline version >= 2 (second guard)" do
      pr = PipelineRun.new
      allow(pr).to receive(:supports_assembly?).and_return(false)
      allow(pr).to receive(:pipeline_version_at_least_2).and_return(true)
      allow(pr).to receive(:postprocess_output_s3_path).and_return("s3://pp")
      expect(pr.annotated_fasta_s3_path).to eq("s3://pp/#{PipelineRun::DAG_ANNOTATED_FASTA_BASENAME}")
    end

    context "on the legacy alignment path (both guards false)" do
      before do
        @pr = PipelineRun.new
        allow(@pr).to receive(:supports_assembly?).and_return(false)
        allow(@pr).to receive(:pipeline_version_at_least_2).and_return(false)
        allow(@pr).to receive(:alignment_output_s3_path).and_return("s3://aln")
      end

      it "uses the multihit basename when the run is multihit (ternary true arm)" do
        allow(@pr).to receive(:pipeline_version_at_least).and_return(true)
        allow(@pr).to receive(:multihit?).and_return(true)
        expect(@pr.annotated_fasta_s3_path).to eq("s3://aln/#{PipelineRun::MULTIHIT_FASTA_BASENAME}")
      end

      it "uses the 6.0.0 hit basename for a non-multihit >=6.0.0 run (hit if arm + ternary false arm)" do
        allow(@pr).to receive(:pipeline_version_at_least).and_return(true)
        allow(@pr).to receive(:multihit?).and_return(false)
        expect(@pr.annotated_fasta_s3_path).to eq("s3://aln/#{PipelineRun::HIT_FASTA_BASENAME}")
      end

      it "uses the cdhitdup hit basename for a non-multihit <6.0.0 run (hit else arm)" do
        allow(@pr).to receive(:pipeline_version_at_least).and_return(false)
        allow(@pr).to receive(:multihit?).and_return(false)
        expect(@pr.annotated_fasta_s3_path).to eq("s3://aln/#{PipelineRun::CDHITDUP_HIT_FASTA_BASENAME}")
      end
    end
  end
end

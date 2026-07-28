# frozen_string_literal: true

require "rails_helper"

# Branch sweep for MngsReadsStatsLoadService. The two existing specs drive the
# service end to end with COMPLETE count sets (legacy illumina, nanopore, and the
# new host-filtering v2 path), so every `if <step> found` guard is only ever
# exercised on its truthy arm. This file calls the private compile_* helpers
# directly with deliberately sparse count arrays so each guard's FALSE arm runs,
# plus the arms the fixtures cannot reach:
#
#   compile_stats                - the case/else (a technology that is neither
#                                  nanopore nor illumina).
#   compile_illumina_stats       - `sub_before && sub_after` false, the
#                                  `rem && frac > 0` else with/without bowtie2_out.
#   compile_illumina_stats_v2    - the "Human" arm of the last-filtering-step
#                                  ternary, `sub_after` false, `sub_before` false.
#   compile_nanopore_stats       - every "step absent" arm.
#   fetch_unmapped_illumina_reads- unidentified absent, supports_assembly? false,
#                                  and the S3-read rescue.
#   calculate_subsample_fraction - both arms of `sub_before.to_i > 0`.
RSpec.describe MngsReadsStatsLoadService do
  let(:host_genome) { create(:host_genome, name: "Mosquito") }
  let(:human_host_genome) { create(:host_genome, name: "Human") }
  let(:project) { create(:project) }

  def pipeline_run_for(genome, technology: PipelineRun::TECHNOLOGY_INPUT[:illumina])
    sample = create(:sample, project: project, host_genome: genome)
    create(:pipeline_run,
           sample: sample,
           technology: technology,
           pipeline_version: "8.0",
           wdl_version: "8.0",
           sfn_execution_arn: "fake-arn")
  end

  let(:pipeline_run) { pipeline_run_for(host_genome) }
  let(:service) { described_class.new(pipeline_run) }

  describe "#compile_stats technology dispatch" do
    it "returns nil for a technology that matches no case arm" do
      # PipelineRun#technology is a plain column; an unrecognized value must fall
      # through the case with no compile_* call (and no exception).
      allow(pipeline_run).to receive(:technology).and_return("pacbio")
      expect(service.send(:compile_stats, pipeline_run, [])).to be_nil
    end

    it "routes nanopore runs to the nanopore compiler" do
      allow(pipeline_run).to receive(:technology).and_return(PipelineRun::TECHNOLOGY_INPUT[:nanopore])
      expect(service).to receive(:compile_nanopore_stats).with(pipeline_run, []).and_return(:nanopore)
      expect(service.send(:compile_stats, pipeline_run, [])).to eq(:nanopore)
    end

    it "routes an illumina run below the new-host-filtering version to the legacy compiler" do
      legacy = pipeline_run_for(host_genome)
      legacy.update!(pipeline_version: "7.0")
      svc = described_class.new(legacy)
      expect(svc).to receive(:compile_illumina_stats).with(legacy, []).and_return(:legacy)
      expect(svc.send(:compile_stats, legacy, [])).to eq(:legacy)
    end

    it "routes an illumina run at the new-host-filtering version to the v2 compiler" do
      expect(service).to receive(:compile_illumina_stats_v2).with(pipeline_run, []).and_return(:v2)
      expect(service.send(:compile_stats, pipeline_run, [])).to eq(:v2)
    end
  end

  describe "#compile_illumina_stats with missing steps" do
    before { allow(service).to receive(:fetch_unmapped_illumina_reads).and_return(nil) }

    it "leaves total/truncated/fraction untouched when no counts are present" do
      pipeline_run.update!(total_reads: nil, truncated: nil, adjusted_remaining_reads: nil)

      result = service.send(:compile_illumina_stats, pipeline_run, [])

      # Every `if <step>` guard took its false arm, so nothing was appended.
      expect(result).to eq([])
      expect(pipeline_run.reload.total_reads).to be_nil
      expect(pipeline_run.truncated).to be_nil
      expect(pipeline_run.adjusted_remaining_reads).to be_nil
    end

    it "falls back to bowtie2_out for remaining reads when gsnap_filter_out is absent" do
      # sub_before present but sub_after absent -> frac stays -1 -> the `rem && frac > 0`
      # else arm runs and picks up bowtie2_out.
      counts = [{ task: "bowtie2_out", reads_after: 500 }]

      service.send(:compile_illumina_stats, pipeline_run, counts)

      expect(pipeline_run.reload.adjusted_remaining_reads).to eq(500)
      expect(pipeline_run.fraction_subsampled).to be_nil
    end

    it "leaves remaining reads unset when neither gsnap_filter_out nor bowtie2_out exist" do
      pipeline_run.update!(adjusted_remaining_reads: nil)
      counts = [{ task: "fastqs", reads_after: 1000 }, { task: "truncated", reads_after: 900 }]

      result = service.send(:compile_illumina_stats, pipeline_run, counts)

      expect(pipeline_run.reload.total_reads).to eq(1000)
      expect(pipeline_run.truncated).to eq(900)
      # Both the `rem` guard and the bowtie2 fallback guard took their false arms.
      expect(pipeline_run.adjusted_remaining_reads).to be_nil
      expect(result.detect { |e| e.key?(:adjusted_remaining_reads) }).to be_nil
    end

    it "scales remaining reads by the subsample fraction when both subsample steps exist" do
      counts = [
        { task: "bowtie2_out", reads_after: 1000 },
        { task: "subsampled_out", reads_after: 500 },
        { task: "gsnap_filter_out", reads_after: 200 },
      ]

      service.send(:compile_illumina_stats, pipeline_run, counts)

      expect(pipeline_run.reload.fraction_subsampled).to eq(0.5)
      expect(pipeline_run.adjusted_remaining_reads).to eq(400) # 200 * (1 / 0.5)
    end

    it "keeps the existing unmapped_reads when the fetch returns nil (the || fallback)" do
      pipeline_run.update!(unmapped_reads: 42)
      service.send(:compile_illumina_stats, pipeline_run, [])
      expect(pipeline_run.reload.unmapped_reads).to eq(42)
    end
  end

  describe "#compile_illumina_stats_v2 with missing steps" do
    before { allow(service).to receive(:fetch_unmapped_illumina_reads).and_return(nil) }

    it "uses the hisat2_host_filtered_out step for a Human host (the Human ternary arm)" do
      human_run = pipeline_run_for(human_host_genome)
      svc = described_class.new(human_run)
      allow(svc).to receive(:fetch_unmapped_illumina_reads).and_return(nil)
      counts = [
        { task: "hisat2_host_filtered_out", reads_after: 4000 },
        { task: "subsampled_out", reads_after: 1000 },
      ]

      svc.send(:compile_illumina_stats_v2, human_run, counts)

      # Only reachable if the Human arm picked hisat2_host_filtered_out as sub_before.
      expect(human_run.fraction_subsampled).to eq(0.25)
      expect(human_run.adjusted_remaining_reads).to eq(1000)
    end

    it "ignores the human-host step name for a non-Human host (the else arm)" do
      counts = [
        { task: "hisat2_host_filtered_out", reads_after: 4000 },
        { task: "subsampled_out", reads_after: 1000 },
      ]

      service.send(:compile_illumina_stats_v2, pipeline_run, counts)

      # Non-Human hosts look for hisat2_human_filtered_out, which is absent, so the
      # inner `if sub_before` arm is false and no fraction is recorded.
      expect(pipeline_run.fraction_subsampled).to be_nil
      expect(pipeline_run.adjusted_remaining_reads).to eq(1000)
    end

    it "records nothing about remaining reads when subsampled_out is absent" do
      pipeline_run.update!(adjusted_remaining_reads: nil)
      result = service.send(:compile_illumina_stats_v2, pipeline_run, [])

      expect(result).to eq([])
      expect(pipeline_run.adjusted_remaining_reads).to be_nil
      expect(pipeline_run.total_reads).to be_nil
      expect(pipeline_run.truncated).to be_nil
    end
  end

  describe "#compile_nanopore_stats with missing steps" do
    let(:nanopore_run) { pipeline_run_for(host_genome, technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore]) }
    let(:nanopore_service) { described_class.new(nanopore_run) }

    it "leaves every derived attribute unset when no counts are present" do
      nanopore_run.update!(total_reads: nil, total_bases: nil, truncated: nil,
                           truncated_bases: nil, adjusted_remaining_reads: nil,
                           unmapped_reads: nil, unmapped_bases: nil)

      result = nanopore_service.send(:compile_nanopore_stats, nanopore_run, [])

      expect(result).to eq([])
      nanopore_run.reload
      expect(nanopore_run.total_reads).to be_nil
      expect(nanopore_run.total_bases).to be_nil
      expect(nanopore_run.truncated).to be_nil
      expect(nanopore_run.truncated_bases).to be_nil
      expect(nanopore_run.adjusted_remaining_reads).to be_nil
      expect(nanopore_run.unmapped_reads).to be_nil
      expect(nanopore_run.unmapped_bases).to be_nil
      expect(nanopore_run.fraction_subsampled).to be_nil
      expect(nanopore_run.fraction_subsampled_bases).to be_nil
    end

    it "skips the read fraction when only the 'before' subsample step is present" do
      counts = [{ task: "human_filtered_reads", reads_after: 100 }]

      nanopore_service.send(:compile_nanopore_stats, nanopore_run, counts)

      expect(nanopore_run.reload.fraction_subsampled).to be_nil
    end

    it "skips the base fraction when only the 'before' base step is present" do
      counts = [{ task: "human_filtered_bases", bases_after: 100 }]

      nanopore_service.send(:compile_nanopore_stats, nanopore_run, counts)

      expect(nanopore_run.reload.fraction_subsampled_bases).to be_nil
    end
  end

  describe "#fetch_unmapped_illumina_reads" do
    it "returns nil when there is no unidentified_fasta entry" do
      expect(service.send(:fetch_unmapped_illumina_reads, pipeline_run, [])).to be_nil
    end

    it "returns the raw alignment count when the run does not support assembly" do
      allow(pipeline_run).to receive(:supports_assembly?).and_return(false)
      counts = [{ task: "unidentified_fasta", reads_after: 77 }]

      expect(service.send(:fetch_unmapped_illumina_reads, pipeline_run, counts)).to eq(77)
    end

    it "prefers the assembly-refined count when the run supports assembly" do
      allow(pipeline_run).to receive(:supports_assembly?).and_return(true)
      allow(Syscall).to receive(:s3_read_json).and_return({ "unidentified_fasta" => 12 })
      counts = [{ task: "unidentified_fasta", reads_after: 77 }]

      expect(service.send(:fetch_unmapped_illumina_reads, pipeline_run, counts)).to eq(12)
    end

    it "falls back to the alignment count when the refined S3 read blows up (rescue arm)" do
      allow(pipeline_run).to receive(:supports_assembly?).and_return(true)
      allow(Syscall).to receive(:s3_read_json).and_raise(StandardError, "no such key")
      counts = [{ task: "unidentified_fasta", reads_after: 77 }]

      expect(service.send(:fetch_unmapped_illumina_reads, pipeline_run, counts)).to eq(77)
    end
  end

  describe "#calculate_subsample_fraction" do
    it "divides after by before when before is positive" do
      expect(service.send(:calculate_subsample_fraction, 400, 100)).to eq(0.25)
    end

    it "returns 1.0 when before is zero (division guard)" do
      expect(service.send(:calculate_subsample_fraction, 0, 100)).to eq(1.0)
    end

    it "returns 1.0 when before is nil" do
      expect(service.send(:calculate_subsample_fraction, nil, 100)).to eq(1.0)
    end
  end

  describe "#load_job_stats" do
    it "keeps only entries carrying a :task key and replaces prior job stats" do
      stats = [
        { task: "fastqs", reads_after: 10 },
        { total_reads: 10 },
        { fraction_subsampled: 1.0 },
      ]

      service.send(:load_job_stats, pipeline_run, stats)

      expect(pipeline_run.reload.job_stats.pluck(:task)).to eq(["fastqs"])
    end
  end
end

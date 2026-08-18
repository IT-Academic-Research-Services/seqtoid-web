require 'rails_helper'
require 'tmpdir'

RSpec.describe S3TransferFilePolicy do
  # A small synthetic policy exercising every matching path, so these tests do
  # not depend on the (evolving) shipped file. The shipped file is covered by the
  # "shipped policy file" context below.
  let(:policy_yaml) do
    <<~YAML
      raw_inputs:
        transfer: false
        reason: "host genomic (PII-adjacent)"
      patterns:
        "*.description.md": { transfer: false, reason: "step description" }
      workflows:
        short-read-mngs:
          status: reviewed
          files:
            "gsnap.m8":           { transfer: true,  reason: "NT alignment" }
            "valid_input1.fastq": { transfer: false, reason: "pre-host-filter (PII-adjacent)" }
          patterns:
            "*_coverage_viz.json": { transfer: true, reason: "coverage viz" }
        amr:
          status: placeholder
          files:
            "primary_AMR_report.tsv": { transfer: true, reason: "final report" }
    YAML
  end

  subject(:policy) do
    dir = Dir.mktmpdir("policy_spec")
    path = File.join(dir, "policy.yml")
    File.write(path, policy_yaml)
    described_class.new(path: path)
  end

  describe "#classify" do
    it "returns :transfer for an exact file marked transfer: true" do
      expect(policy.classify("short-read-mngs", "gsnap.m8")).to eq(:transfer)
    end

    it "returns :skip for an exact file marked transfer: false" do
      expect(policy.classify("short-read-mngs", "valid_input1.fastq")).to eq(:skip)
    end

    it "matches a workflow-level glob pattern" do
      expect(policy.classify("short-read-mngs", "1234_coverage_viz.json")).to eq(:transfer)
    end

    it "falls back to a cross-workflow (global) pattern" do
      expect(policy.classify("short-read-mngs", "annotated_out.description.md")).to eq(:skip)
    end

    it "prefers an exact match over patterns" do
      # gsnap.m8 is exact-true; ensure no pattern flips it
      expect(policy.classify("short-read-mngs", "gsnap.m8")).to eq(:transfer)
    end

    it "returns :unclassified for a file matching nothing (omission signal)" do
      expect(policy.classify("short-read-mngs", "brand_new_output.bin")).to eq(:unclassified)
    end

    it "raises for an unknown workflow" do
      expect { policy.classify("nonexistent", "x") }
        .to raise_error(S3TransferFilePolicy::UnknownWorkflowError)
    end
  end

  describe "#transfer?" do
    it "is true only for :transfer" do
      expect(policy.transfer?("short-read-mngs", "gsnap.m8")).to be(true)
      expect(policy.transfer?("short-read-mngs", "valid_input1.fastq")).to be(false)
      expect(policy.transfer?("short-read-mngs", "brand_new_output.bin")).to be(false)
    end
  end

  describe "#raw_inputs_transfer?" do
    it "reflects the policy (withheld)" do
      expect(policy.raw_inputs_transfer?).to be(false)
    end
  end

  describe "#known_workflow? / #workflow_status" do
    it "reports known workflows and their status" do
      expect(policy.known_workflow?("amr")).to be(true)
      expect(policy.known_workflow?("nope")).to be(false)
      expect(policy.workflow_status("short-read-mngs")).to eq("reviewed")
    end
  end

  # Structural integrity of the actual file we ship, independent of its contents.
  describe "the shipped policy file" do
    let(:shipped) { described_class.new }
    let(:raw) { YAML.safe_load(File.read(S3TransferFilePolicy::DEFAULT_POLICY_PATH)) }

    it "loads and withholds raw inputs" do
      expect(shipped.raw_inputs_transfer?).to be(false)
    end

    it "defines every expected workflow" do
      %w[short-read-mngs amr consensus-genome long-read-mngs].each do |wf|
        expect(shipped.known_workflow?(wf)).to be(true), "missing workflow #{wf}"
      end
    end

    it "gives every entry a boolean transfer and a non-empty reason (completeness contract)" do
      raw.fetch("workflows").each do |wf, cfg|
        cfg.fetch("files", {}).merge(cfg.fetch("patterns", {})).each do |name, entry|
          expect(entry["transfer"]).to be_in([true, false]), "#{wf}/#{name} transfer not boolean"
          expect(entry["reason"].to_s).not_to be_empty, "#{wf}/#{name} missing reason"
        end
      end
    end

    it "uses only valid workflow statuses" do
      raw.fetch("workflows").each_value do |cfg|
        expect(cfg["status"]).to be_in(S3TransferFilePolicy::VALID_STATUSES)
      end
    end

    it "marks short-read-mngs reviewed and classifies representative files correctly" do
      expect(shipped.workflow_status("short-read-mngs")).to eq("reviewed")
      # a result file transfers; a pre-host-filter (PII-adjacent) read does not
      expect(shipped.classify("short-read-mngs", "taxon_counts_with_dcr.json")).to eq(:transfer)
      expect(shipped.classify("short-read-mngs", "valid_input1.fastq")).to eq(:skip)
      # only the coverage-viz SUMMARY transfers; per-taxon coverage-viz files do not
      expect(shipped.classify("short-read-mngs", "coverage_viz_summary.json")).to eq(:transfer)
      expect(shipped.classify("short-read-mngs", "abc_coverage_viz.json")).to eq(:skip)
    end
  end
end

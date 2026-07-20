# frozen_string_literal: true

require "rails_helper"

# Coverage Wave: branch sweep for AmrMetricsService. The main spec
# (amr_metrics_service_spec.rb) only ever exercises the LEGACY host-filtering
# path (uses_modern_host_filtering? == false) with a non-Human host genome, so
# every MODERN arm is untaken. This spec drives the opposite arms:
#
#   - initializer ternary: host_genome.name == "Human"  (the HISAT2_HOST arm)
#     vs != "Human" (the HISAT2_HUMAN arm)
#   - retrieve_modern_passed_qc: both-present compute vs each nil guard operand
#   - retrieve_modern_subsampled_fraction: compute vs > 0 == false (1.0) vs the
#     two nil guard operands
#   - retrieve_modern_dcr: compute vs each nil guard operand
#   - retrieve_modern_passed_filters: the modern passthrough
#   - compute_percentage_reads: the adjusted_remaining_reads.nil? left operand
#   - retrieve_ercc_counts: the @uses_modern_host_filtering ? MODERN_ERCC_FILE
#     arm (main spec only hits the legacy ERCC_FILE arm)
#   - retrieve_counts: the @uses_modern_host_filtering == true if-arm, its inner
#     NON_HUMAN vs HUMAN host-count ternary, the input_read "fastqs" step_key
#     ternary, and the SfnExecution::OutputNotFoundError rescue branch
#
# All assertions check concrete computed values so the test fails if the covered
# arm is deleted or inverted -- no vacuous characterization.
RSpec.describe AmrMetricsService, type: :service do
  # Build a service instance without touching the DB: the initializer only
  # reaches for workflow_run.workflow_by_class.uses_modern_host_filtering? and
  # workflow_run.sample.host_genome.name, both easily stubbed.
  def build_service(uses_modern:, host_name: "Human", workflow: "amr")
    workflow_by_class = double("workflow_by_class", uses_modern_host_filtering?: uses_modern)
    host_genome = double("host_genome", name: host_name)
    sample = double("sample", host_genome: host_genome)
    workflow_run = double(
      "workflow_run",
      workflow_by_class: workflow_by_class,
      sample: sample,
      workflow: workflow
    )
    AmrMetricsService.new(workflow_run)
  end

  describe "#initialize last-filtering-step ternary" do
    it "uses the HISAT2_HOST step when the host genome is Human (the == arm)" do
      service = build_service(uses_modern: true, host_name: "Human")
      expect(service.instance_variable_get(:@last_filtering_step_name))
        .to eq(AmrMetricsService::HISAT2_HOST_FILTERED_OUT_STEP_NAME)
    end

    it "uses the HISAT2_HUMAN step when the host genome is non-Human (the != arm)" do
      service = build_service(uses_modern: true, host_name: "Mosquito")
      expect(service.instance_variable_get(:@last_filtering_step_name))
        .to eq(AmrMetricsService::HISAT2_HUMAN_FILTERED_OUT_STEP_NAME)
    end
  end

  describe "#retrieve_modern_passed_qc" do
    let(:service) { build_service(uses_modern: true, host_name: "Human") }

    it "computes 100 * fastp_out / bowtie2_ercc_filtered_out when both present" do
      result = service.send(:retrieve_modern_passed_qc, "fastp_out" => 50, "bowtie2_ercc_filtered_out" => 200)
      expect(result).to eq(25.0)
    end

    it "returns nil when fastp_out is missing (left guard operand)" do
      result = service.send(:retrieve_modern_passed_qc, "fastp_out" => nil, "bowtie2_ercc_filtered_out" => 200)
      expect(result).to be_nil
    end

    it "returns nil when bowtie2_ercc_filtered_out is missing (right guard operand)" do
      result = service.send(:retrieve_modern_passed_qc, "fastp_out" => 50, "bowtie2_ercc_filtered_out" => nil)
      expect(result).to be_nil
    end
  end

  describe "#retrieve_modern_subsampled_fraction" do
    # Human host -> @last_filtering_step_name == "hisat2_host_filtered_out".
    let(:service) { build_service(uses_modern: true, host_name: "Human") }
    let(:step) { AmrMetricsService::HISAT2_HOST_FILTERED_OUT_STEP_NAME }

    it "computes subsampled_out / count_after_last_step when that count is > 0" do
      result = service.send(:retrieve_modern_subsampled_fraction, step => 10, "subsampled_out" => 2)
      expect(result).to eq(0.2)
    end

    it "returns 1.0 when the count after the last step is 0 (the ternary else)" do
      result = service.send(:retrieve_modern_subsampled_fraction, step => 0, "subsampled_out" => 2)
      # 0 is truthy in Ruby so the guard passes; 0 > 0 is false -> 1.0
      expect(result).to eq(1.0)
    end

    it "returns nil when the count after the last step is missing (left guard operand)" do
      result = service.send(:retrieve_modern_subsampled_fraction, step => nil, "subsampled_out" => 2)
      expect(result).to be_nil
    end

    it "returns nil when subsampled_out is missing (right guard operand)" do
      result = service.send(:retrieve_modern_subsampled_fraction, step => 10, "subsampled_out" => nil)
      expect(result).to be_nil
    end
  end

  describe "#retrieve_modern_dcr" do
    let(:service) { build_service(uses_modern: true, host_name: "Human") }
    let(:step) { AmrMetricsService::HISAT2_HOST_FILTERED_OUT_STEP_NAME }

    it "computes count_after_last_step / czid_dedup_out when both present" do
      result = service.send(:retrieve_modern_dcr, "czid_dedup_out" => 4, step => 8)
      expect(result).to eq(2.0)
    end

    it "returns nil when czid_dedup_out is missing (left guard operand)" do
      result = service.send(:retrieve_modern_dcr, "czid_dedup_out" => nil, step => 8)
      expect(result).to be_nil
    end

    it "returns nil when the count after the last step is missing (right guard operand)" do
      result = service.send(:retrieve_modern_dcr, "czid_dedup_out" => 4, step => nil)
      expect(result).to be_nil
    end
  end

  describe "#retrieve_modern_passed_filters" do
    let(:service) { build_service(uses_modern: true, host_name: "Human") }

    it "returns the subsampled_out count directly" do
      result = service.send(:retrieve_modern_passed_filters, "subsampled_out" => 17)
      expect(result).to eq(17)
    end
  end

  describe "#compute_percentage_reads" do
    let(:service) { build_service(uses_modern: true, host_name: "Human") }

    it "returns nil when adjusted_remaining_reads is nil (left operand of the ||)" do
      # The main spec only drives total_reads.nil?; this drives the left operand.
      expect(service.send(:compute_percentage_reads, nil, 200)).to be_nil
    end

    it "computes 100 * remaining / total when both are present (the false-false arm)" do
      expect(service.send(:compute_percentage_reads, 50, 200)).to eq(25.0)
    end
  end

  describe "#retrieve_ercc_counts modern-file arm" do
    it "reads the MODERN_ERCC_FILE when using modern host filtering and sums ERCC rows" do
      service = build_service(uses_modern: true, host_name: "Human", workflow: "amr")
      workflow_run = service.instance_variable_get(:@workflow_run)
      modern_path = "amr.#{AmrMetricsService::HOST_FILTER_STAGE_NAME}.#{AmrMetricsService::MODERN_ERCC_FILE}"
      ercc_content = "not_ercc\t99\nERCC-00002\t5\nERCC-00003\t7\n"
      expect(workflow_run).to receive(:output).with(modern_path).and_return(ercc_content)

      # Only the two ERCC-prefixed rows count: 5 + 7 = 12.
      expect(service.send(:retrieve_ercc_counts)).to eq(12)
    end
  end

  describe "#retrieve_counts modern arm" do
    it "gathers MODERN_COUNTS + HUMAN host counts, maps input_read via the fastqs step_key, and rescues missing outputs" do
      service = build_service(uses_modern: true, host_name: "Human", workflow: "amr")
      workflow_run = service.instance_variable_get(:@workflow_run)

      # For a Human host the inner ternary picks HUMAN_HOST_FILTER_COUNTS, so the
      # expected set is MODERN_COUNTS + HUMAN_HOST_FILTER_COUNTS (8 counts).
      counts_map = {
        "input_read_count" => { "fastqs" => 40 },
        "bowtie2_ercc_filtered_out_count" => { "bowtie2_ercc_filtered_out" => 30 },
        "fastp_out_count" => { "fastp_out" => 35 },
        "czid_dedup_out_count" => { "czid_dedup_out" => 20 },
        "subsampled_out_count" => { "subsampled_out" => 10 },
        "bowtie2_host_filtered_out_count" => { "bowtie2_host_filtered_out" => 25 },
        "hisat2_host_filtered_out_count" => { "hisat2_host_filtered_out" => 22 },
      }

      allow(workflow_run).to receive(:output) do |path|
        count = path.split(".").last
        # validate_input_out_count is deliberately absent -> exercise the rescue.
        raise SfnExecution::OutputNotFoundError.new(count, counts_map.keys) if count == "validate_input_out_count"

        counts_map.fetch(count).to_json
      end

      expect(Rails.logger).to receive(:warn).with("Could not find file: validate_input_out_count")

      result = service.send(:retrieve_counts)

      # input_read used the "fastqs" step_key ternary arm; the rest used the
      # step_name arm. The rescued count is absent from the hash.
      expect(result["input_read"]).to eq(40)
      expect(result["bowtie2_ercc_filtered_out"]).to eq(30)
      expect(result["hisat2_host_filtered_out"]).to eq(22)
      expect(result).not_to have_key("validate_input_out")
    end
  end
end

# frozen_string_literal: true

require "rails_helper"

# Coverage Wave (branch): residual branch sweep for AmrMetricsService#retrieve_counts,
# complementing amr_metrics_service_branches_spec.rb (which drives the modern +
# Human-host arm). This file drives the arms that are still untaken:
#
#   - the `if @uses_modern_host_filtering` ELSE arm (legacy COUNTS list)
#   - the NON_HUMAN_HOST_FILTER_COUNTS arm of the inner last-filtering-step ternary
#   - the `&.to_i` nil receiver arm, when the output JSON has no entry for the step
RSpec.describe AmrMetricsService, type: :service do
  # Same doubles-only construction the sibling branch spec uses: the initializer
  # only reads workflow_by_class.uses_modern_host_filtering? and
  # sample.host_genome.name.
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
    described_class.new(workflow_run)
  end

  def stub_outputs(service, counts_map)
    workflow_run = service.instance_variable_get(:@workflow_run)
    allow(workflow_run).to receive(:output) do |path|
      count = path.split(".").last
      raise SfnExecution::OutputNotFoundError.new(count, counts_map.keys) unless counts_map.key?(count)

      counts_map.fetch(count).to_json
    end
  end

  it "uses the legacy COUNTS list when modern host filtering is off (the if else-arm)" do
    service = build_service(uses_modern: false, host_name: "Mosquito")

    stub_outputs(service, {
                   "input_read_count" => { "fastqs" => 100 },
                   "gsnap_filter_out_count" => { "gsnap_filter_out" => 90 },
                   "bowtie2_out_count" => { "bowtie2_out" => 80 },
                   "subsampled_out_count" => { "subsampled_out" => 70 },
                   "czid_dedup_out_count" => { "czid_dedup_out" => 60 },
                   "priceseq_out_count" => { "priceseq_out" => 50 },
                   "star_out_count" => { "star_out" => 40 },
                 })

    result = service.send(:retrieve_counts)

    expect(result.keys).to contain_exactly(
      "input_read", "gsnap_filter_out", "bowtie2_out", "subsampled_out",
      "czid_dedup_out", "priceseq_out", "star_out"
    )
    expect(result["input_read"]).to eq(100)
    expect(result["star_out"]).to eq(40)
    # The modern-only steps are not requested at all on the legacy path.
    expect(result).not_to have_key("bowtie2_ercc_filtered_out")
  end

  it "adds the human-filtered counts for a non-Human host (the NON_HUMAN ternary arm)" do
    service = build_service(uses_modern: true, host_name: "Mosquito")

    stub_outputs(service, {
                   "input_read_count" => { "fastqs" => 40 },
                   "bowtie2_ercc_filtered_out_count" => { "bowtie2_ercc_filtered_out" => 30 },
                   "fastp_out_count" => { "fastp_out" => 35 },
                   "czid_dedup_out_count" => { "czid_dedup_out" => 20 },
                   "subsampled_out_count" => { "subsampled_out" => 10 },
                   "validate_input_out_count" => { "validate_input_out" => 45 },
                   "bowtie2_host_filtered_out_count" => { "bowtie2_host_filtered_out" => 25 },
                   "hisat2_host_filtered_out_count" => { "hisat2_host_filtered_out" => 22 },
                   "bowtie2_human_filtered_out_count" => { "bowtie2_human_filtered_out" => 18 },
                   "hisat2_human_filtered_out_count" => { "hisat2_human_filtered_out" => 15 },
                 })

    result = service.send(:retrieve_counts)

    # These two keys only appear on the NON_HUMAN arm.
    expect(result["bowtie2_human_filtered_out"]).to eq(18)
    expect(result["hisat2_human_filtered_out"]).to eq(15)
    expect(result["validate_input_out"]).to eq(45)
  end

  it "stores nil when the output JSON has no entry for the step (the &. nil arm)" do
    service = build_service(uses_modern: false, host_name: "Mosquito")

    stub_outputs(service, {
                   "input_read_count" => { "fastqs" => 100 },
                   # Present file, but keyed by something else -> lookup is nil, `&.to_i` short-circuits.
                   "gsnap_filter_out_count" => { "unexpected_key" => 90 },
                   "bowtie2_out_count" => { "bowtie2_out" => 80 },
                   "subsampled_out_count" => { "subsampled_out" => 70 },
                   "czid_dedup_out_count" => { "czid_dedup_out" => 60 },
                   "priceseq_out_count" => { "priceseq_out" => 50 },
                   "star_out_count" => { "star_out" => 40 },
                 })

    result = service.send(:retrieve_counts)

    expect(result).to have_key("gsnap_filter_out")
    expect(result["gsnap_filter_out"]).to be_nil
    expect(result["input_read"]).to eq(100)
  end
end

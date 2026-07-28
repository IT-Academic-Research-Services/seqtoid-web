# frozen_string_literal: true

require "rails_helper"

# Coverage Wave: second branch sweep for AmrMetricsService, complementing
# amr_metrics_service_branches_spec.rb (which drives the MODERN host-filtering
# arms). This file drives the arms neither the main spec nor that sweep reaches:
#
#   - #call: the start_from_mngs? then-arm, and both arms of the
#     `@uses_modern_host_filtering ? modern : legacy` ternary in the else-arm
#   - #metrics_from_pipeline_run: the `&.mean` / `&.standard_deviation`
#     present AND nil receiver arms
#   - the LEGACY guard clauses (retrieve_passed_qc / retrieve_subsampled_fraction /
#     retrieve_passed_filters / retrieve_dcr) with each operand missing in turn
#   - retrieve_subsampled_fraction's `bowtie2_out > 0` ternary else arm
#   - compute_percentage_reads: the total_reads.nil? RIGHT operand of the ||
#   - retrieve_ercc_counts: the legacy-file arm and its StandardError rescue
#   - retrieve_insert_size_metrics: the METRICS-CLASS header arm, the
#     "within 2 lines of the header" arm, the `tsv_lines.length >= 2` break arm,
#     and the malformed-file (length != 2) raise -> rescue -> nil path
RSpec.describe AmrMetricsService, type: :service do
  def build_service(uses_modern: false, host_name: "Mosquito", workflow: "amr", workflow_run: nil)
    workflow_by_class = double("workflow_by_class", uses_modern_host_filtering?: uses_modern)
    host_genome = double("host_genome", name: host_name)
    sample = double("sample", host_genome: host_genome)
    run = workflow_run || double("workflow_run")
    allow(run).to receive(:workflow_by_class).and_return(workflow_by_class)
    allow(run).to receive(:sample).and_return(sample)
    allow(run).to receive(:workflow).and_return(workflow)
    AmrMetricsService.new(run)
  end

  describe "#call dispatch" do
    it "returns pipeline-run metrics when the workflow run started from mngs (the then-arm)" do
      service = build_service
      allow(service).to receive(:workflow_run_started_from_mngs?).and_return(true)
      allow(service).to receive(:metrics_from_pipeline_run).and_return(total_reads: 7)
      expect(service).not_to receive(:retrieve_counts)

      expect(service.call).to eq(total_reads: 7)
    end

    it "uses the LEGACY calculator when not started from mngs and modern filtering is off" do
      service = build_service(uses_modern: false)
      allow(service).to receive(:workflow_run_started_from_mngs?).and_return(false)
      allow(service).to receive(:retrieve_counts).and_return("input_read" => 40)
      allow(service).to receive(:calculate_metrics).and_return(legacy: true)
      expect(service).not_to receive(:calculate_modern_metrics)

      expect(service.call).to eq(legacy: true)
    end

    it "uses the MODERN calculator when not started from mngs and modern filtering is on" do
      service = build_service(uses_modern: true)
      allow(service).to receive(:workflow_run_started_from_mngs?).and_return(false)
      allow(service).to receive(:retrieve_counts).and_return("input_read" => 40)
      allow(service).to receive(:calculate_modern_metrics).and_return(modern: true)
      expect(service).not_to receive(:calculate_metrics)

      expect(service.call).to eq(modern: true)
    end
  end

  describe "#workflow_run_started_from_mngs?" do
    it "is true only for the literal string 'true'" do
      run = double("workflow_run")
      allow(run).to receive(:get_input).with("start_from_mngs").and_return("true")
      expect(build_service(workflow_run: run).send(:workflow_run_started_from_mngs?)).to be(true)
    end

    it "is false for any other input value" do
      run = double("workflow_run")
      allow(run).to receive(:get_input).with("start_from_mngs").and_return(nil)
      expect(build_service(workflow_run: run).send(:workflow_run_started_from_mngs?)).to be(false)
    end
  end

  describe "#metrics_from_pipeline_run insert-size safe navigation" do
    def service_for_pipeline_run(pipeline_run)
      run = double("workflow_run", id: 42)
      allow(run).to receive(:get_input).and_return("true")
      service = build_service(workflow_run: run)
      allow(service.instance_variable_get(:@workflow_run).sample).to receive(:pipeline_runs)
        .and_return(double("relation", non_deprecated: double("scope", first: pipeline_run)))
      service
    end

    let(:pipeline_run) do
      values = {
        WorkflowRun::TOTAL_READS_KEY => 100,
        WorkflowRun::QC_PERCENT_KEY => 90.0,
        WorkflowRun::REMAINING_READS_KEY => 50,
        WorkflowRun::COMPRESSION_RATIO_KEY => 1.5,
        WorkflowRun::TOTAL_ERCC_READS_KEY => 5,
        WorkflowRun::SUBSAMPLED_FRACTION_KEY => 0.5,
      }
      double("pipeline_run", id: 9).tap do |pr|
        allow(pr).to receive(:[]) { |key| values[key] }
      end
    end

    it "reads mean/standard_deviation when the metric set exists (the receiver-present arm)" do
      allow(InsertSizeMetricSet).to receive(:find_by).with(pipeline_run_id: 9)
                                                     .and_return(double("metric_set", mean: 114, standard_deviation: 21.5))

      metrics = service_for_pipeline_run(pipeline_run).send(:metrics_from_pipeline_run)

      expect(metrics[WorkflowRun::INSERT_SIZE_MEAN_KEY]).to eq(114)
      expect(metrics[WorkflowRun::INSERT_SIZE_STD_DEV_KEY]).to eq(21.5)
      expect(metrics[WorkflowRun::TOTAL_READS_KEY]).to eq(100)
      expect(metrics[WorkflowRun::PERCENT_REMAINING_KEY]).to eq(50.0)
    end

    it "yields nil insert-size metrics when there is no metric set (the nil-receiver arm)" do
      allow(InsertSizeMetricSet).to receive(:find_by).with(pipeline_run_id: 9).and_return(nil)

      metrics = service_for_pipeline_run(pipeline_run).send(:metrics_from_pipeline_run)

      expect(metrics[WorkflowRun::INSERT_SIZE_MEAN_KEY]).to be_nil
      expect(metrics[WorkflowRun::INSERT_SIZE_STD_DEV_KEY]).to be_nil
    end
  end

  describe "legacy guard clauses" do
    let(:service) { build_service(uses_modern: false) }

    it "#retrieve_passed_qc computes 100 * priceseq_out / star_out when both are present" do
      expect(service.send(:retrieve_passed_qc, "priceseq_out" => 2, "star_out" => 5)).to eq(40.0)
    end

    it "#retrieve_passed_qc returns nil when priceseq_out is missing (left operand)" do
      expect(service.send(:retrieve_passed_qc, "star_out" => 5)).to be_nil
    end

    it "#retrieve_passed_qc returns nil when star_out is missing (right operand)" do
      expect(service.send(:retrieve_passed_qc, "priceseq_out" => 2)).to be_nil
    end

    it "#retrieve_subsampled_fraction divides when bowtie2_out is positive (ternary then)" do
      expect(service.send(:retrieve_subsampled_fraction, "bowtie2_out" => 4, "subsampled_out" => 2)).to eq(0.5)
    end

    it "#retrieve_subsampled_fraction returns 1.0 when bowtie2_out is zero (ternary else)" do
      expect(service.send(:retrieve_subsampled_fraction, "bowtie2_out" => 0, "subsampled_out" => 2)).to eq(1.0)
    end

    it "#retrieve_subsampled_fraction returns nil when bowtie2_out is missing (left operand)" do
      expect(service.send(:retrieve_subsampled_fraction, "subsampled_out" => 2)).to be_nil
    end

    it "#retrieve_subsampled_fraction returns nil when subsampled_out is missing (right operand)" do
      expect(service.send(:retrieve_subsampled_fraction, "bowtie2_out" => 4)).to be_nil
    end

    it "#retrieve_passed_filters scales gsnap_filter_out by the inverse subsampled fraction" do
      counts = { "bowtie2_out" => 4, "subsampled_out" => 2, "gsnap_filter_out" => 3 }
      expect(service.send(:retrieve_passed_filters, counts)).to eq(6)
    end

    it "#retrieve_passed_filters returns nil when the subsampled fraction is nil (left operand)" do
      expect(service.send(:retrieve_passed_filters, "gsnap_filter_out" => 3)).to be_nil
    end

    it "#retrieve_passed_filters returns nil when gsnap_filter_out is missing (right operand)" do
      expect(service.send(:retrieve_passed_filters, "bowtie2_out" => 4, "subsampled_out" => 2)).to be_nil
    end

    it "#retrieve_dcr divides priceseq_out by czid_dedup_out when both are present" do
      expect(service.send(:retrieve_dcr, "priceseq_out" => 3, "czid_dedup_out" => 6)).to eq(0.5)
    end

    it "#retrieve_dcr returns nil when priceseq_out is missing (left operand)" do
      expect(service.send(:retrieve_dcr, "czid_dedup_out" => 6)).to be_nil
    end

    it "#retrieve_dcr returns nil when czid_dedup_out is missing (right operand)" do
      expect(service.send(:retrieve_dcr, "priceseq_out" => 3)).to be_nil
    end

    it "#compute_percentage_reads returns nil when total_reads is nil (right operand of the ||)" do
      expect(service.send(:compute_percentage_reads, 10, nil)).to be_nil
    end
  end

  describe "#retrieve_ercc_counts legacy arm" do
    it "sums the ERCC rows from the legacy ERCC file" do
      run = double("workflow_run")
      allow(run).to receive(:output)
        .with("amr.#{AmrMetricsService::HOST_FILTER_STAGE_NAME}.#{AmrMetricsService::ERCC_FILE}")
        .and_return("header\tvalue\nERCC-1\t2\nERCC-2\t3\nOTHER\t99\n")
      service = build_service(uses_modern: false, workflow_run: run)

      expect(service.send(:retrieve_ercc_counts)).to eq(5)
    end

    it "returns nil when the ERCC output cannot be loaded (the rescue arm)" do
      run = double("workflow_run")
      allow(run).to receive(:output).and_raise(SfnExecution::OutputNotFoundError.new("k", ["p"]))
      service = build_service(uses_modern: false, workflow_run: run)

      expect(service.send(:retrieve_ercc_counts)).to be_nil
    end
  end

  describe "#retrieve_insert_size_metrics" do
    def service_with_output(text)
      run = double("workflow_run", id: 11)
      allow(run).to receive(:output).and_return(text)
      build_service(uses_modern: false, workflow_run: run)
    end

    it "parses the two rows following the METRICS CLASS header and breaks out afterwards" do
      tsv = "# Started on: Thu Jun 30 00:08:32 UTC 2022\n" \
            "## METRICS CLASS\tpicard.analysis.InsertSizeMetrics\n" \
            "MEAN_INSERT_SIZE\tSTANDARD_DEVIATION\n" \
            "114.174518\t21.577178\n" \
            "trailing junk line that must be skipped by the break arm\n" \
            "another trailing junk line\n"

      expect(service_with_output(tsv).send(:retrieve_insert_size_metrics, "x.txt")).to eq([114, 21.577178])
    end

    it "returns nil when the file has no METRICS CLASS header at all (raise -> rescue)" do
      expect(service_with_output("no header here\njust noise\n").send(:retrieve_insert_size_metrics, "x.txt")).to be_nil
    end

    it "returns nil when the header is present but the metrics rows are missing (raise -> rescue)" do
      tsv = "## METRICS CLASS\tpicard.analysis.InsertSizeMetrics\n"
      expect(service_with_output(tsv).send(:retrieve_insert_size_metrics, "x.txt")).to be_nil
    end
  end
end

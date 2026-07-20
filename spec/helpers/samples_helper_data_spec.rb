require "rails_helper"

# Coverage for the data-shaping / formatting helpers in SamplesHelper that are
# not exercised by samples_helper_spec.rb (which focuses on upload, filtering,
# and CSV-list generation).
RSpec.describe SamplesHelper, type: :helper do
  describe "nil-safe pipeline-run getters" do
    it "return nil / falsey values when the pipeline run is nil" do
      expect(helper.get_adjusted_remaining_reads(nil)).to be_nil
      expect(helper.get_insert_size_metric_set(nil)).to be_nil
      expect(helper.get_insert_size_mean(nil)).to be_nil
      expect(helper.get_insert_size_standard_deviation(nil)).to be_nil
      expect(helper.get_compression_ratio(nil)).to be_nil
      expect(helper.get_qc_percent(nil)).to be_nil
      expect(helper.compute_percentage_reads(nil)).to be_nil
    end

    it "computes percentage reads from a pipeline run double" do
      pr = instance_double(PipelineRun, adjusted_remaining_reads: 50, total_reads: 200)
      expect(helper.compute_percentage_reads(pr)).to eq(25.0)
    end

    it "returns nil percentage reads when a component is missing" do
      pr = instance_double(PipelineRun, adjusted_remaining_reads: nil, total_reads: 200)
      expect(helper.compute_percentage_reads(pr)).to be_nil
    end
  end

  # The nil-safe getters above cover only the pr == nil branch. These exercise the
  # complementary "pipeline run present" branch of each guard (and, for the
  # blank-aware getters, both the blank and non-blank sides of the `|| ...blank?`
  # short-circuit) so the getter's conditional is fully branch-covered.
  describe "pipeline-run getters with a present pipeline run" do
    it "reads adjusted_remaining_reads straight off the pipeline run" do
      pr = instance_double(PipelineRun, adjusted_remaining_reads: 1234)
      expect(helper.get_adjusted_remaining_reads(pr)).to eq(1234)
    end

    it "returns the pipeline run's insert_size_metric_set" do
      metric_set = instance_double(InsertSizeMetricSet)
      pr = instance_double(PipelineRun, insert_size_metric_set: metric_set)
      expect(helper.get_insert_size_metric_set(pr)).to be(metric_set)
    end

    it "reads the mean off a present insert-size metric set" do
      metric_set = instance_double(InsertSizeMetricSet, mean: 305.5)
      pr = instance_double(PipelineRun, insert_size_metric_set: metric_set)
      expect(helper.get_insert_size_mean(pr)).to eq(305.5)
    end

    it "reads the standard deviation off a present insert-size metric set" do
      metric_set = instance_double(InsertSizeMetricSet, standard_deviation: 12.3)
      pr = instance_double(PipelineRun, insert_size_metric_set: metric_set)
      expect(helper.get_insert_size_standard_deviation(pr)).to eq(12.3)
    end

    it "returns the compression ratio when it is present and non-blank" do
      pr = instance_double(PipelineRun, compression_ratio: 2.5)
      expect(helper.get_compression_ratio(pr)).to eq(2.5)
    end

    it "returns nil compression ratio when the value is blank" do
      pr = instance_double(PipelineRun, compression_ratio: nil)
      expect(helper.get_compression_ratio(pr)).to be_nil
    end

    it "returns the qc percent when it is present and non-blank" do
      pr = instance_double(PipelineRun, qc_percent: 98.7)
      expect(helper.get_qc_percent(pr)).to eq(98.7)
    end

    it "returns nil qc percent when the value is blank" do
      pr = instance_double(PipelineRun, qc_percent: "")
      expect(helper.get_qc_percent(pr)).to be_nil
    end
  end

  describe "#insert_size_metric_hash" do
    it "returns empty-string values when there is no metric set" do
      pr = instance_double(PipelineRun, insert_size_metric_set: nil)
      result = helper.insert_size_metric_hash(pr)
      expect(result.values.uniq).to eq([''])
      expect(result.keys).to include(:insert_size_median, :insert_size_mean, :insert_size_read_pairs)
    end

    it "surfaces the values from a present metric set" do
      metric_set = instance_double(
        InsertSizeMetricSet,
        median: 300, mode: 310, median_absolute_deviation: 5,
        min: 100, max: 500, mean: 305.5, standard_deviation: 12.3, read_pairs: 1000
      )
      pr = instance_double(PipelineRun, insert_size_metric_set: metric_set)
      result = helper.insert_size_metric_hash(pr)
      expect(result[:insert_size_median]).to eq(300)
      expect(result[:insert_size_mean]).to eq(305.5)
      expect(result[:insert_size_read_pairs]).to eq(1000)
    end
  end

  describe "#summary_stats_hash" do
    it "defaults to empty strings when given nil" do
      result = helper.summary_stats_hash(nil)
      expect(result[:quality_control]).to eq('')
      expect(result[:compression_ratio]).to eq('')
      expect(result[:reads_after_star]).to eq('')
    end

    it "rounds percentages and ratios and passes through read counts" do
      result = helper.summary_stats_hash(
        qc_percent: 98.76543,
        compression_ratio: 2.98765,
        percent_remaining: 42.98765,
        reads_after_star: 12_345
      )
      expect(result[:quality_control]).to eq(98.765)
      expect(result[:compression_ratio]).to eq(2.99)
      expect(result[:passed_filters_percent]).to eq(42.988)
      expect(result[:reads_after_star]).to eq(12_345)
    end
  end

  describe "#ont_read_length_hash" do
    it "returns a fixed set of empty-string read-length metrics" do
      result = helper.ont_read_length_hash
      expect(result.values.uniq).to eq([''])
      expect(result.keys).to include(:read_length_median, :read_length_mean)
    end
  end

  describe "#ont_metric_hash" do
    it "merges pipeline-run bases and summary stats with the read-length hash" do
      pr = { total_bases: 5000, fraction_subsampled_bases: 0.5 }
      summary_stats = {
        qc_percent: 88.88888,
        bases_after_quality_filtered_bases: 4000,
        bases_after_human_filtered_bases: 3500,
      }
      result = helper.ont_metric_hash(pr, summary_stats)
      expect(result[:total_bases]).to eq(5000)
      expect(result[:subsampled_fraction_bases]).to eq(0.5)
      expect(result[:bases_after_quality_filter_percent]).to eq(88.889)
      expect(result[:bases_after_quality_filter]).to eq(4000)
      expect(result[:bases_after_minimap2_host_filtering]).to eq(3500)
      # From the merged ont_read_length_hash.
      expect(result).to have_key(:read_length_median)
    end

    it "defaults empty strings when summary stats are nil" do
      pr = { total_bases: nil, fraction_subsampled_bases: nil }
      result = helper.ont_metric_hash(pr, nil)
      expect(result[:total_bases]).to eq('')
      expect(result[:bases_after_quality_filter_percent]).to eq('')
    end
  end

  describe "#increment_sample_name" do
    it "returns the original name when it is not taken" do
      expect(helper.increment_sample_name("sample_a", %w[other])).to eq("sample_a")
    end

    it "appends _1 for a single collision" do
      expect(helper.increment_sample_name("sample_a", %w[sample_a])).to eq("sample_a_1")
    end

    it "is case-insensitive when checking collisions" do
      expect(helper.increment_sample_name("Sample_A", %w[sample_a])).to eq("Sample_A_1")
    end

    it "keeps incrementing until it finds a free name" do
      existing = %w[sample_a sample_a_1 sample_a_1_2]
      # sample_a -> sample_a_1 (taken) -> sample_a_1_2 (taken) -> sample_a_1_2_3
      expect(helper.increment_sample_name("sample_a", existing)).to eq("sample_a_1_2_3")
    end
  end

  describe "#get_result_status_description_for_errored_sample" do
    it "returns SKIPPED for a do-not-process sample" do
      sample = instance_double(Sample, upload_error: Sample::DO_NOT_PROCESS)
      expect(helper.get_result_status_description_for_errored_sample(sample))
        .to eq(result_status_description: 'SKIPPED')
    end

    it "returns FAILED for a generic upload error" do
      sample = instance_double(Sample, upload_error: "SOME_OTHER_ERROR")
      expect(helper.get_result_status_description_for_errored_sample(sample))
        .to eq(result_status_description: 'FAILED')
    end

    it "returns INCOMPLETE for a stalled local upload" do
      sample = instance_double(Sample, upload_error: Sample::UPLOAD_ERROR_LOCAL_UPLOAD_STALLED)
      expect(helper.get_result_status_description_for_errored_sample(sample))
        .to eq(result_status_description: 'INCOMPLETE')
    end
  end

  describe "#generate_benchmark_sample_name" do
    let(:project) { create(:project) }
    let(:sample_a) { create(:sample, project: project, name: "alpha") }
    let(:sample_b) { create(:sample, project: project, name: "beta") }

    it "joins sample names with the benchmark prefix and _vs_ separator" do
      name = helper.generate_benchmark_sample_name([sample_a.id, sample_b.id], project.id)
      expect(name).to eq("benchmark_alpha_vs_beta")
    end

    # When a ground_truth_file is supplied, the helper interpolates the file
    # value into the sample name (previously it appended the literal token
    # "ground_truth_file" due to a missing #{...}; fixed in #294).
    it "interpolates the ground truth file value when one is present" do
      name = helper.generate_benchmark_sample_name([sample_a.id], project.id, "truth.tsv")
      expect(name).to eq("benchmark_alpha_vs_truth.tsv")
    end
  end
end

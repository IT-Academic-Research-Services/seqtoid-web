require "rails_helper"

# Coverage Wave 5: the existing mngs_reads_stats_load_service_spec covers the
# legacy illumina path and the nanopore path. This file exercises the NEW host
# filtering stage path (pipeline_version >= 8): compile_illumina_stats_v2 and the
# fastp QC count fetching (fetch_fastp_qc_counts), which the old fixtures don't hit.
RSpec.describe MngsReadsStatsLoadService do
  let(:fake_sample_bucket) { ENV['SAMPLES_BUCKET_NAME'] }
  let(:fake_arn) { "fake-arn" }
  let(:version_prefix) { "short-read-mngs-8" }

  # Counts for the new host-filtering stage. Includes bowtie2_ercc_filtered_out,
  # which triggers the extra fastp QC fetch.
  let(:steps) do
    {
      "fastqs": 10_000,
      "validate_input_out": 10_000,
      "fastp_out": 9000,
      "bowtie2_ercc_filtered_out": 8500,
      "truncated": 9500,
      "hisat2_human_filtered_out": 4000,
      "subsampled_out": 2000,
    }
  end

  # fastp.json filtering_result section consumed by fetch_fastp_qc_counts.
  let(:fastp_json) do
    {
      "filtering_result" => {
        "low_quality_reads" => 100,
        "too_short_reads" => 50,
        "too_long_reads" => 10,
        "low_complexity_reads" => 20,
        "too_many_N_reads" => 5,
      },
    }
  end

  before do
    count_files = steps.map do |k, v|
      ["#{version_prefix}/#{k}.count", { body: { "#{k}": v }.to_json }]
    end.to_h
    # Ensure the fastp file uses the constant as the key
    count_files["#{version_prefix}/#{PipelineRun::FASTP_JSON_FILE}"] = { body: { "filtering_result" => fastp_json["filtering_result"] }.to_json }

    @mock_aws_clients = { s3: Aws::S3::Client.new(stub_responses: true) }
    # Properly mock the AwsClient lookup used in the service
    allow(AwsClient).to receive(:[]).with(:s3).and_return(@mock_aws_clients[:s3])
    # Also stub the global S3_CLIENT if the service uses it directly
    stub_const("S3_CLIENT", @mock_aws_clients[:s3])
    stub_const("SAMPLES_BUCKET_NAME", "test-bucket")

    # Mock the S3 Resource chain
    @mock_s3_resource = instance_double(Aws::S3::Resource)
    @mock_bucket = instance_double(Aws::S3::Bucket)
    @mock_object_collection = instance_double(Aws::S3::Object::Collection)

    # Include the fastp file in the mock objects
    all_files = steps.keys.map { |f| "#{version_prefix}/#{f}.count" } + ["#{version_prefix}/#{PipelineRun::FASTP_JSON_FILE}"]
    @mock_objects = all_files.map do |path|
      obj = instance_double(Aws::S3::Object)
      allow(obj).to receive(:key).and_return(path)
      obj
    end

    allow(Aws::S3::Resource).to receive(:new).with(client: @mock_aws_clients[:s3]).and_return(@mock_s3_resource)
    allow(@mock_s3_resource).to receive(:bucket).with("test-bucket").and_return(@mock_bucket)
    # Match any prefix that ends with version_prefix
    allow(@mock_bucket).to receive(:objects).with(hash_including(:prefix)).and_return(@mock_object_collection)

    keys = @mock_objects.map(&:key)
    allow(@mock_object_collection).to receive(:map).and_return(keys)

    @mock_aws_clients[:s3].stub_responses(
      :get_object, lambda { |context|
        # Mock S3 get_object based on the key, return JSON string as body
        if count_files.key?(context.params[:key])
          { body: count_files[context.params[:key]][:body] }
        else
          { body: "{}" }
        end
      }
    )

    # upload_stats_file shells out to s3 via Syscall; no-op it.
    allow(Syscall).to receive(:s3_cp).and_return(true)

    @pipeline_run = create(:pipeline_run,
                           technology: PipelineRun::TECHNOLOGY_INPUT[:illumina],
                           pipeline_execution_strategy: "step_function",
                           s3_output_prefix: "s3://#{fake_sample_bucket}",
                           sfn_execution_arn: fake_arn,
                           wdl_version: "8.0",
                           pipeline_version: "8.0")
    # Avoid the assembly-refined-count S3 read in fetch_unmapped_illumina_reads.
    allow_any_instance_of(PipelineRun).to receive(:supports_assembly?).and_return(false)
    @response = MngsReadsStatsLoadService.call(@pipeline_run)
  end

  it "loads total_reads and truncated from the new-stage counts" do
    expect(@pipeline_run.total_reads).to eq(steps[:fastqs])
    expect(@pipeline_run.truncated).to eq(steps[:truncated])
  end

  it "sets adjusted_remaining_reads from subsampled_out" do
    expect(@pipeline_run.adjusted_remaining_reads).to eq(steps[:subsampled_out])
  end

  it "computes the subsample fraction from hisat2_human_filtered_out and subsampled_out" do
    expected = (1.0 * steps[:subsampled_out]) / steps[:hisat2_human_filtered_out]
    expect(@pipeline_run.fraction_subsampled).to be_within(1e-9).of(expected)
  end

  it "loads the fastp QC derived counts into job stats" do
    tasks = @pipeline_run.job_stats.pluck(:task)
    expect(tasks).to include("fastp_low_quality_reads", "fastp_too_short_reads", "fastp_low_complexity_reads")
  end

  it "derives fastp_low_quality_reads from bowtie2_ercc_filtered_out minus low_quality_reads" do
    stat = @pipeline_run.job_stats.find_by(task: "fastp_low_quality_reads")
    expect(stat.reads_after).to eq(steps[:bowtie2_ercc_filtered_out] - fastp_json["filtering_result"]["low_quality_reads"])
  end
end

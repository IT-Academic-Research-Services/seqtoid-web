require "rails_helper"

RSpec.describe MngsReadsStatsLoadService do
  let(:fake_sample_bucket) { ENV['SAMPLES_BUCKET_NAME'] }
  let(:fake_arn) { "fake-arn" }

  context "when workflow is short-read-mngs" do
    let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }
    let(:fake_short_read_version) { "short-read-mngs-7" }
    before do
      @steps = {
        "fastqs": 1122,
        "validate_input_out": 1122,
        "star_out": 832,
        "trimmomatic_out": 644,
        "truncated": 644,
        "priceseq_out": 362,
        "lzw_out": 360,
        "czid_dedup_out": 356,
        "subsampled_out": 332,
        "bowtie2_out": 332,
        "gsnap_filter_out": 330,
        "unidentified_fasta": 12,
      }

      @mock_aws_clients = { s3: Aws::S3::Client.new(stub_responses: true) }
      allow(AwsClient).to receive(:[]).with(:s3).and_return(@mock_aws_clients[:s3])
      stub_const("S3_CLIENT", @mock_aws_clients[:s3])
      stub_const("SAMPLES_BUCKET_NAME", fake_sample_bucket)

      # Mock S3 get_object to be more flexible
      allow(@mock_aws_clients[:s3]).to receive(:get_object) do |params|
        key = params[:key]
        step = File.basename(key, ".count")

        # Handle the fastp file if it exists, though not in this context.
        body = if @steps.key?(step.to_sym)
                 { "#{step}": @steps[step.to_sym] }.to_json
               else
                 "{}"
               end

        double('S3Object', body: StringIO.new(body))
      end

      # Mock the S3 Resource chain
      @mock_s3_resource = instance_double(Aws::S3::Resource)
      @mock_bucket = instance_double(Aws::S3::Bucket)
      @mock_object_collection = instance_double(Aws::S3::Object::Collection)

      all_files = @steps.keys.map { |f| "#{fake_short_read_version}/#{f}.count" }
      @mock_objects = all_files.map do |path|
        obj = instance_double(Aws::S3::Object)
        allow(obj).to receive(:key).and_return(path)
        obj
      end

      allow(Aws::S3::Resource).to receive(:new).with(client: @mock_aws_clients[:s3]).and_return(@mock_s3_resource)
      allow(@mock_s3_resource).to receive(:bucket).with(fake_sample_bucket).and_return(@mock_bucket)
      allow(@mock_bucket).to receive(:objects).with(hash_including(:prefix)).and_return(@mock_object_collection)
      allow(@mock_object_collection).to receive(:map).and_return(@mock_objects.map(&:key))
      allow(@mock_object_collection).to receive(:grep).and_return(@mock_objects)
      allow(@mock_object_collection).to receive(:each).and_yield(@mock_objects[0])

      @pipeline_run = create(:pipeline_run,
                             technology: PipelineRun::TECHNOLOGY_INPUT[:illumina],
                             pipeline_execution_strategy: "step_function",
                             s3_output_prefix: "s3://#{fake_sample_bucket}",
                             sfn_execution_arn: fake_arn,
                             wdl_version: "7.0")
      @response = MngsReadsStatsLoadService.call(@pipeline_run)
    end

    it "should load job stats from s3 *.count files into JobStats" do
      job_stats = @pipeline_run.job_stats
      expect(job_stats.pluck(:task, :reads_after)).to match_array(@steps.map { |k, v| [k.to_s, v] })
    end

    it "should set attributes on the pipeline run instance" do
      expect(@pipeline_run.total_reads).to eq(@steps[:fastqs])
      expect(@pipeline_run.truncated).to eq(@steps[:truncated])
      expect(@pipeline_run.adjusted_remaining_reads).to eq(@steps[:gsnap_filter_out])
    end
  end

  context "when workflow is long-read-mngs" do
    let(:workflow) { WorkflowRun::WORKFLOW[:long_read_mngs] }
    let(:fake_short_read_version) { "long-read-mngs-1" }
    before do
      @steps = {
        "host_filtered_bases": 4_665_640,
        "host_filtered_reads": 1402,
        "human_filtered_bases": 3_451_961,
        "human_filtered_reads": 1118,
        "original_bases": 59_709_854,
        "original_reads": 20_000,
        "quality_filtered_bases": 59_700_618,
        "quality_filtered_reads": 19_984,
        "subsampled_bases": 3_451_961,
        "subsampled_reads": 1118,
        "validated_bases": 59_709_854,
        "validated_reads": 20_000,
      }

      @mock_aws_clients = { s3: Aws::S3::Client.new(stub_responses: true) }
      allow(AwsClient).to receive(:[]).with(:s3).and_return(@mock_aws_clients[:s3])
      stub_const("S3_CLIENT", @mock_aws_clients[:s3])
      stub_const("SAMPLES_BUCKET_NAME", fake_sample_bucket)

      # Mock S3 get_object to be more flexible
      allow(@mock_aws_clients[:s3]).to receive(:get_object) do |params|
        key = params[:key]
        step = File.basename(key, ".count")

        body = if @steps.key?(step.to_sym)
                 { "#{step}": @steps[step.to_sym] }.to_json
               else
                 "{}"
               end

        double('S3Object', body: StringIO.new(body))
      end

      # Mock the S3 Resource chain
      @mock_s3_resource = instance_double(Aws::S3::Resource)
      @mock_bucket = instance_double(Aws::S3::Bucket)
      @mock_object_collection = instance_double(Aws::S3::Object::Collection)

      all_files = @steps.keys.map { |f| "#{fake_short_read_version}/#{f}.count" }
      @mock_objects = all_files.map do |path|
        obj = instance_double(Aws::S3::Object)
        allow(obj).to receive(:key).and_return(path)
        obj
      end

      allow(Aws::S3::Resource).to receive(:new).with(client: @mock_aws_clients[:s3]).and_return(@mock_s3_resource)
      allow(@mock_s3_resource).to receive(:bucket).with(fake_sample_bucket).and_return(@mock_bucket)
      allow(@mock_bucket).to receive(:objects).with(hash_including(:prefix)).and_return(@mock_object_collection)
      allow(@mock_object_collection).to receive(:map).and_return(@mock_objects.map(&:key))
      allow(@mock_object_collection).to receive(:grep).and_return(@mock_objects)
      allow(@mock_object_collection).to receive(:each).and_yield(@mock_objects[0])

      @pipeline_run = create(:pipeline_run,
                             technology: PipelineRun::TECHNOLOGY_INPUT[:nanopore],
                             pipeline_execution_strategy: "step_function",
                             s3_output_prefix: "s3://#{fake_sample_bucket}",
                             sfn_execution_arn: fake_arn,
                             wdl_version: "1.0")
      @response = MngsReadsStatsLoadService.call(@pipeline_run)
    end

    it "should load job stats from s3 *.count files into JobStats" do
      job_stats_reads, job_stats_bases = @pipeline_run.job_stats.partition { |stat| stat.task.include?("reads") }
      steps_reads, steps_bases = @steps.partition { |k, _v| k.to_s.include?("reads") }
      expect(job_stats_reads.pluck(:task, :reads_after)).to match_array(steps_reads.map { |k, v| [k.to_s, v] })
      expect(job_stats_bases.pluck(:task, :bases_after)).to match_array(steps_bases.map { |k, v| [k.to_s, v] })
    end

    it "should set attributes on the pipeline run instance" do
      expect(@pipeline_run.total_reads).to eq(@steps[:original_reads])
      expect(@pipeline_run.total_bases).to eq(@steps[:original_bases])
      expect(@pipeline_run.truncated).to eq(@steps[:validated_reads])
      expect(@pipeline_run.truncated_bases).to eq(@steps[:validated_bases])
      expect(@pipeline_run.fraction_subsampled).to eq(1.0)
      expect(@pipeline_run.fraction_subsampled_bases).to eq(1.0)
      expect(@pipeline_run.adjusted_remaining_reads).to eq(@steps[:subsampled_reads])
    end
  end
end

require "rails_helper"

# Branch coverage wave 2 for PipelineOutputsHelper. The existing
# pipeline_outputs_helper_spec / _branches_spec never call
# #get_taxon_fasta_from_pipeline_run directly, and only drive the raising arm of
# #get_presigned_s3_url. This file closes:
#   * the nil-pipeline_run guard and the byterange-missing guard of
#     get_taxon_fasta_from_pipeline_run, plus the successful S3 read.
#   * the "bucket lookup returned nothing" and "object does not exist" arms of
#     get_presigned_s3_url (previously only the rescue arm was driven).
# All AWS access is stubbed; nothing touches the network.
RSpec.describe PipelineOutputsHelper, type: :helper do
  describe "#get_taxon_fasta_from_pipeline_run" do
    let(:project) { create(:project) }
    let(:sample) { create(:sample, project: project) }
    let(:pipeline_run) { create(:pipeline_run, sample: sample) }

    it "returns an empty string when there is no pipeline run" do
      expect(PipelineOutputsHelper::Client).not_to receive(:get_object)

      result = helper.get_taxon_fasta_from_pipeline_run(nil, 573, TaxonCount::TAX_LEVEL_SPECIES, "NT")
      expect(result).to eq("")
    end

    it "returns an empty string when the run has no byterange for that taxon" do
      expect(pipeline_run.taxon_byteranges).to be_empty
      expect(PipelineOutputsHelper::Client).not_to receive(:get_object)

      result = helper.get_taxon_fasta_from_pipeline_run(pipeline_run, 573, TaxonCount::TAX_LEVEL_SPECIES, "NT")
      expect(result).to eq("")
    end

    it "reads the byterange out of S3 when one exists" do
      create(:taxon_byterange,
             pipeline_run_id: pipeline_run.id,
             taxid: 573,
             hit_type: "NT",
             first_byte: 10,
             last_byte: 42)

      body = instance_double(StringIO, read: ">read1\nACGT\n")
      expect(PipelineOutputsHelper::Client).to receive(:get_object)
        .with(hash_including(range: "bytes=10-42"))
        .and_return(instance_double(Aws::S3::Types::GetObjectOutput, body: body))

      result = helper.get_taxon_fasta_from_pipeline_run(pipeline_run, 573, TaxonCount::TAX_LEVEL_SPECIES, "NT")
      expect(result).to eq(">read1\nACGT\n")
    end
  end

  describe "#get_presigned_s3_url" do
    it "returns nil when the bucket lookup yields nothing" do
      allow(PipelineOutputsHelper::Client).to receive(:head_bucket).and_return(nil)

      url = helper.get_presigned_s3_url(s3_path: "s3://some-bucket/some/key.fasta", filename: "key.fasta", duration: 30)
      expect(url).to be_nil
    end

    it "returns nil when the object does not exist in the bucket" do
      allow(PipelineOutputsHelper::Client).to receive(:head_bucket).and_return(true)

      missing_object = instance_double(Aws::S3::Object, exists?: false)
      bucket = instance_double(Aws::S3::Bucket, object: missing_object)
      allow(Aws::S3::Resource).to receive(:new).and_return(instance_double(Aws::S3::Resource, bucket: bucket))

      url = helper.get_presigned_s3_url(bucket_name: "some-bucket", key: "missing.fasta", filename: "missing.fasta", duration: 30)
      expect(url).to be_nil
    end

    it "returns the presigned url when the object exists" do
      allow(PipelineOutputsHelper::Client).to receive(:head_bucket).and_return(true)

      object = instance_double(Aws::S3::Object, exists?: true, presigned_url: "https://signed.example/url")
      bucket = instance_double(Aws::S3::Bucket, object: object)
      allow(Aws::S3::Resource).to receive(:new).and_return(instance_double(Aws::S3::Resource, bucket: bucket))

      url = helper.get_presigned_s3_url(bucket_name: "some-bucket", key: "present.fasta", filename: "present.fasta", duration: 30)
      expect(url).to eq("https://signed.example/url")
    end
  end
end

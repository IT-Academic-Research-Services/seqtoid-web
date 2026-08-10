require "rails_helper"

RSpec.describe S3Util do
  let(:fake_database_bucket) { "fake-database-bucket" }
  let(:ontology_file_key) { "amr/ontology/2020-01-01/aro.json" }
  let(:test_expression) { "SELECT * FROM S3Object[*].NorA LIMIT 1" }
  let(:sample_gene_response) { "{\"label\":\"norA\",\"accession\":\"3000391\",\"description\":\"NorA is an AMR gene.\",\"synonyms\":[],\"publications\":[\"Publication 1. (PMID 31415926)\",\"Publication 2. (PMID 12345678)\",\"Publication 3. (PMID 98765432)\"],\"geneFamily\":[{\"label\":\"gene family label\",\"description\":\"gene family description.\"}],\"drugClass\":{\"label\":\"Drug class\",\"description\":\"Drug class description.\"},\"genbankAccession\":\"HE123456\"}," }
  let(:successful_stream_response) do
    [
      {
        message_type: 'event',
        event_type: 'records',
        payload: StringIO.new(sample_gene_response),
      },
    ].each
  end
  before do
    @mock_aws_clients = {
      s3: Aws::S3::Client.new(stub_responses: true),
    }
    allow(AwsClient).to receive(:[]) { |client|
      @mock_aws_clients[client]
    }
  end

  describe "#s3_select_json" do
    # this test uses the example of getting information on a single gene
    # from a JSON file with information about many genes
    it "should return a single string on success" do
      @mock_aws_clients[:s3].stub_responses(:select_object_content, { payload: successful_stream_response })
      entry = S3Util.s3_select_json(fake_database_bucket, ontology_file_key, test_expression)
      expect(entry).to be_instance_of(String)
      expect(entry).to eq(sample_gene_response)
    end

    # On error (like a gene name not found in the json file), return a blank string.
    it "handles errors from S3" do
      # S3 Select surfaces a server-side failure as an Aws::S3::Errors::ServiceError,
      # which s3_select_json rescues and turns into "". (CZID-119: the old in-stream
      # error-event stub format is no longer valid under aws-sdk-core 3.248.)
      @mock_aws_clients[:s3].stub_responses(:select_object_content, 'InternalError')
      expect { S3Util.s3_select_json(fake_database_bucket, ontology_file_key, test_expression) }.not_to raise_error
      entry = S3Util.s3_select_json(fake_database_bucket, ontology_file_key, test_expression)
      expect(entry).to be_instance_of(String)
      expect(entry.blank?).to be_truthy
    end
  end

  describe "#abort_multipart_uploads" do
    let(:bucket) { "fake-samples-bucket" }
    let(:prefix) { "samples/1/2/" }

    it "aborts every incomplete multipart upload under the prefix" do
      @mock_aws_clients[:s3].stub_responses(
        :list_multipart_uploads,
        {
          uploads: [
            { key: "samples/1/2/fastqs/file.1.fastq.gz", upload_id: "upload-a" },
            { key: "samples/1/2/fastqs/file.2.fastq.gz", upload_id: "upload-b" },
          ],
        }
      )

      aborted_args = []
      allow(@mock_aws_clients[:s3]).to receive(:abort_multipart_upload) do |args|
        aborted_args << args
      end

      count = S3Util.abort_multipart_uploads(bucket, prefix)

      expect(count).to eq(2)
      expect(aborted_args).to contain_exactly(
        { bucket: bucket, key: "samples/1/2/fastqs/file.1.fastq.gz", upload_id: "upload-a" },
        { bucket: bucket, key: "samples/1/2/fastqs/file.2.fastq.gz", upload_id: "upload-b" }
      )
    end

    it "does nothing when there are no incomplete multipart uploads" do
      @mock_aws_clients[:s3].stub_responses(:list_multipart_uploads, { uploads: [] })
      expect(@mock_aws_clients[:s3]).not_to receive(:abort_multipart_upload)
      expect(S3Util.abort_multipart_uploads(bucket, prefix)).to eq(0)
    end
  end

  describe "#upload_to_s3" do
    let(:key) { "downloads/67/Reads (Non-host).tar.gz" }
    let(:content) { "some-content" }

    it "uploads the content to S3 when the bucket name is present" do
      uploaded_args = nil
      allow(@mock_aws_clients[:s3]).to receive(:put_object) { |args| uploaded_args = args }

      S3Util.upload_to_s3("fake-downloads-bucket", key, content)

      expect(uploaded_args).to eq(bucket: "fake-downloads-bucket", key: key, body: content)
    end

    # CZID-296: a blank bucket (unset downloads-bucket env var) must fail fast with an
    # actionable error instead of the opaque SDK "Invalid bucket name" deep in put_object.
    it "raises an actionable error and does not call the SDK when the bucket name is blank" do
      expect(@mock_aws_clients[:s3]).not_to receive(:put_object)

      [nil, "", "  "].each do |blank_bucket|
        expect do
          S3Util.upload_to_s3(blank_bucket, key, content)
        end.to raise_error(ArgumentError, /bucket name is blank/)
      end
    end
  end

  describe "#copy_with_tags" do
    let(:source_path) { "s3://src-bucket/import/big_R1.fastq.gz" }
    let(:dest_path) { "s3://dst-bucket/samples/1/2/fastqs/big_R1.fastq.gz" }
    let(:tags) { { type: "sample", id: "2" } }
    let(:tagging) { "type=sample&id=2" }

    it "uses a single copy_object (not multipart) for objects at or under 5 GiB" do
      @mock_aws_clients[:s3].stub_responses(:head_object, { content_length: S3Util::MAX_SINGLE_COPY_BYTES })
      copy_args = nil
      allow(@mock_aws_clients[:s3]).to receive(:copy_object) { |args| copy_args = args }
      expect_any_instance_of(Aws::S3::Object).not_to receive(:copy_from)

      S3Util.copy_with_tags(source_path, dest_path, tags)

      expect(copy_args).to eq(
        copy_source: "src-bucket/import/big_R1.fastq.gz",
        bucket: "dst-bucket",
        key: "samples/1/2/fastqs/big_R1.fastq.gz",
        tagging_directive: "REPLACE",
        tagging: tagging
      )
    end

    # SMP-1746: a >5 GiB source used to hit the copy_object 5 GiB cap and fail with
    # S3_UPLOAD_FAILED before a run was ever created. Large objects must go multipart.
    it "uses a multipart copy for objects larger than 5 GiB" do
      @mock_aws_clients[:s3].stub_responses(:head_object, { content_length: S3Util::MAX_SINGLE_COPY_BYTES + 1 })
      expect(@mock_aws_clients[:s3]).not_to receive(:copy_object)
      expect_any_instance_of(Aws::S3::Object).to receive(:copy_from)
        .with("src-bucket/import/big_R1.fastq.gz", hash_including(multipart_copy: true, tagging: tagging))

      S3Util.copy_with_tags(source_path, dest_path, tags)
    end
  end
end

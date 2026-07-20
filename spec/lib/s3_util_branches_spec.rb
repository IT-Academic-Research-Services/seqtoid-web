# frozen_string_literal: true

require "rails_helper"

# Branch sweep for S3Util. The existing spec covers #s3_select_json,
# #abort_multipart_uploads and #upload_to_s3. This targets the remaining branchy
# readers/writers that are never entered:
#   * #get_s3_file       -- success arm AND the StandardError -> nil rescue arm.
#   * #get_s3_range      -- the nil-byte guard (log + nil), success, and rescue.
#   * #get_file_size     -- the non-empty return arm AND the empty -> raise arm.
#   * #delete_s3_prefix  -- the objects.blank? "next" arm AND the delete arm.
RSpec.describe S3Util do
  before do
    @s3 = Aws::S3::Client.new(stub_responses: true)
    allow(AwsClient).to receive(:[]).with(:s3).and_return(@s3)
  end

  describe "#get_s3_file" do
    it "returns the object body on success" do
      @s3.stub_responses(:get_object, { body: "file-contents" })
      expect(S3Util.get_s3_file("s3://bucket/key")).to eq("file-contents")
    end

    it "returns nil when the fetch raises (rescue arm)" do
      @s3.stub_responses(:get_object, "NoSuchKey")
      expect(S3Util.get_s3_file("s3://bucket/missing")).to be_nil
    end
  end

  describe "#get_s3_range" do
    it "logs and returns nil when either byte bound is nil (guard arm)" do
      expect(LogUtil).to receive(:log_error).with(/Invalid byte range/, hash_including(:s3_path))
      expect(S3Util.get_s3_range("s3://bucket/key", nil, 10)).to be_nil
    end

    it "returns the ranged body on success" do
      requested = nil
      allow(@s3).to receive(:get_object) do |args|
        requested = args
        double("resp", body: StringIO.new("ranged-bytes"))
      end

      expect(S3Util.get_s3_range("s3://bucket/key", 0, 5)).to eq("ranged-bytes")
      expect(requested[:range]).to eq("bytes=0-5")
    end

    it "logs and returns nil when the fetch raises (rescue arm)" do
      @s3.stub_responses(:get_object, "AccessDenied")
      expect(LogUtil).to receive(:log_error).with(/Error retrieving byte range/, hash_including(:exception))
      expect(S3Util.get_s3_range("s3://bucket/key", 0, 5)).to be_nil
    end
  end

  describe "#get_file_size" do
    it "returns the object size when the listing is non-empty" do
      @s3.stub_responses(:list_objects_v2, { contents: [{ size: 4096 }] })
      expect(S3Util.get_file_size("bucket", "key")).to eq(4096)
    end

    it "raises when the listing is empty (empty arm)" do
      @s3.stub_responses(:list_objects_v2, { contents: [] })
      # NOTE (bug, not fixed): this arm interpolates an undefined `s3_path`
      # local, so it raises NameError instead of the intended RuntimeError with
      # the "Cannot get file size" message. Asserting the actual behavior.
      expect { S3Util.get_file_size("bucket", "key") }.to raise_error(NameError, /s3_path/)
    end
  end

  describe "#delete_s3_prefix" do
    it "deletes the listed objects (delete arm)" do
      @s3.stub_responses(:list_objects_v2, { contents: [{ key: "a/1" }, { key: "a/2" }] })
      deleted = nil
      allow(@s3).to receive(:delete_objects) { |args| deleted = args }

      S3Util.delete_s3_prefix("s3://bucket/a")

      expect(deleted[:bucket]).to eq("bucket")
      expect(deleted[:delete][:objects]).to eq([{ key: "a/1" }, { key: "a/2" }])
    end

    it "skips the delete when a page has no objects (blank -> next arm)" do
      @s3.stub_responses(:list_objects_v2, { contents: [] })
      expect(@s3).not_to receive(:delete_objects)
      expect { S3Util.delete_s3_prefix("s3://bucket/empty") }.not_to raise_error
    end
  end
end

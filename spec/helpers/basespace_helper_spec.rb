require "rails_helper"
require "webmock/rspec"

RSpec.describe BasespaceHelper, type: :helper do
  describe "#files_for_basespace_dataset" do
    let(:file_one_name) { "sample_one.fastq.gz" }
    let(:file_one_href_content) { "https://basespace.amazonaws.com/abc123/sample_one.fastq.gz" }
    let(:file_one_href) { "https://api.basespace.illumina.com/v2/files/1" }

    let(:file_two_name) { "sample_two.fastq.gz" }
    let(:file_two_href_content) { "https://basespace.amazonaws.com/abc123/sample_two.fastq.gz" }
    let(:file_two_href) { "https://api.basespace.illumina.com/v2/files/2" }

    let(:fake_dataset_id) { "abc123real" }
    let(:fake_access_token) { "token" }

    context "basespace API call returns successfully" do
      before do
        allow(HttpHelper).to receive(:get_json)
          .and_return(
            "Items" => [
              {
                "Name" => file_one_name,
                "HrefContent" => file_one_href_content,
                "Href" => file_one_href,
                "Id" => "1",
                "Size" => 1_234,
              },
              {
                "Name" => file_two_name,
                "HrefContent" => file_two_href_content,
                "Href" => file_two_href,
                "Id" => "2",
                "Size" => 5_678,
              },
            ]
          )
      end

      it "returns selected fields of files" do
        files = helper.files_for_basespace_dataset(fake_dataset_id, fake_access_token)

        expect(files).to eq(
          [
            {
              name: file_one_name,
              download_path: file_one_href_content,
              source_path: file_one_href,
              size: 1_234,
            },
            {
              name: file_two_name,
              download_path: file_two_href_content,
              source_path: file_two_href,
              size: 5_678,
            },
          ]
        )
      end
    end

    context "basespace API returns zero samples" do
      before do
        allow(HttpHelper).to receive(:get_json)
          .and_return("Items" => [])
      end

      it "returns zero samples" do
        files = helper.files_for_basespace_dataset(fake_dataset_id, fake_access_token)

        expect(files).to eq([])
      end
    end

    context "basespace API call fails" do
      before do
        allow(HttpHelper).to receive(:get_json)
          .and_return("ErrorMessage" => "Failed to get files")
      end

      it "returns nil" do
        expect(LogUtil).to receive(:log_error).with(
          "Fetch files for Basespace dataset failed with error: Failed to get files",
          hash_including(
            basespace_token_fingerprint: SecretRedaction.fingerprint("token"),
            dataset_id: "abc123real"
          )
        ).exactly(1).times
        files = helper.files_for_basespace_dataset(fake_dataset_id, fake_access_token)

        expect(files).to eq(nil)
      end
    end
  end

  # SMP-1733. Basespace caps a single list response at BASESPACE_PAGE_SIZE (1024)
  # items. These examples prove the client follows Limit/Offset pagination and
  # returns the full concatenated list instead of silently truncating at 1024.
  describe "pagination" do
    let(:access_token) { "token" }

    # v1pre3 projects nest their list under "Response"; v2 datasets do not.
    def project_page(items)
      { "Response" => { "Items" => items } }
    end

    def project_items(count, offset = 0)
      Array.new(count) { |i| { "Id" => (offset + i).to_s, "Name" => "P#{offset + i}" } }
    end

    def dataset_page(items)
      { "Items" => items }
    end

    def dataset_items(count, offset = 0)
      Array.new(count) do |i|
        n = offset + i
        {
          "Id" => n.to_s,
          "Name" => "s#{n}",
          "TotalSize" => 10,
          "Project" => { "Name" => "proj" },
          "DatasetType" => { "Name" => "fastq" },
          "Attributes" => { "common_fastq" => { "IsPairedEnd" => false } },
        }
      end
    end

    context "#basespace_projects" do
      it "makes a single request when the first page is short" do
        expect(HttpHelper).to receive(:get_json)
          .with(BASESPACE_CURRENT_PROJECTS_URL, hash_including(offset: 0, limit: BASESPACE_PAGE_SIZE), anything, anything)
          .once.and_return(project_page(project_items(3)))

        result = helper.basespace_projects(access_token)
        expect(result.length).to eq(3)
        expect(result.first).to eq(id: "0", name: "P0")
      end

      it "requests successive offsets and returns the full list when there are more than 1024 projects" do
        first_page = project_page(project_items(BASESPACE_PAGE_SIZE, 0))
        second_page = project_page(project_items(10, BASESPACE_PAGE_SIZE))

        expect(HttpHelper).to receive(:get_json)
          .with(BASESPACE_CURRENT_PROJECTS_URL, hash_including(offset: 0, limit: BASESPACE_PAGE_SIZE), anything, anything)
          .ordered.and_return(first_page)
        expect(HttpHelper).to receive(:get_json)
          .with(BASESPACE_CURRENT_PROJECTS_URL, hash_including(offset: BASESPACE_PAGE_SIZE, limit: BASESPACE_PAGE_SIZE), anything, anything)
          .ordered.and_return(second_page)

        result = helper.basespace_projects(access_token)
        expect(result.length).to eq(BASESPACE_PAGE_SIZE + 10)
        expect(result.first).to eq(id: "0", name: "P0")
        expect(result.last).to eq(id: (BASESPACE_PAGE_SIZE + 9).to_s, name: "P#{BASESPACE_PAGE_SIZE + 9}")
      end

      it "stops on the trailing empty page when the total is an exact multiple of the page size" do
        expect(HttpHelper).to receive(:get_json)
          .with(BASESPACE_CURRENT_PROJECTS_URL, hash_including(offset: 0, limit: BASESPACE_PAGE_SIZE), anything, anything)
          .ordered.and_return(project_page(project_items(BASESPACE_PAGE_SIZE, 0)))
        expect(HttpHelper).to receive(:get_json)
          .with(BASESPACE_CURRENT_PROJECTS_URL, hash_including(offset: BASESPACE_PAGE_SIZE, limit: BASESPACE_PAGE_SIZE), anything, anything)
          .ordered.and_return(project_page([]))

        result = helper.basespace_projects(access_token)
        expect(result.length).to eq(BASESPACE_PAGE_SIZE)
      end
    end

    context "#samples_for_basespace_project" do
      let(:url) { BASESPACE_PROJECT_DATASETS_URL % "p1" }

      it "makes a single request when the first page is short" do
        expect(HttpHelper).to receive(:get_json)
          .with(url, hash_including(offset: 0, limit: BASESPACE_PAGE_SIZE), anything, anything)
          .once.and_return(dataset_page(dataset_items(2)))

        result = helper.samples_for_basespace_project("p1", access_token)
        expect(result.length).to eq(2)
      end

      it "requests successive offsets and returns the full list when there are more than 1024 datasets" do
        first_page = dataset_page(dataset_items(BASESPACE_PAGE_SIZE, 0))
        second_page = dataset_page(dataset_items(5, BASESPACE_PAGE_SIZE))

        expect(HttpHelper).to receive(:get_json)
          .with(url, hash_including(offset: 0, limit: BASESPACE_PAGE_SIZE), anything, anything)
          .ordered.and_return(first_page)
        expect(HttpHelper).to receive(:get_json)
          .with(url, hash_including(offset: BASESPACE_PAGE_SIZE, limit: BASESPACE_PAGE_SIZE), anything, anything)
          .ordered.and_return(second_page)

        result = helper.samples_for_basespace_project("p1", access_token)
        expect(result.length).to eq(BASESPACE_PAGE_SIZE + 5)
        expect(result.first[:basespace_dataset_id]).to eq("0")
        expect(result.last[:basespace_dataset_id]).to eq((BASESPACE_PAGE_SIZE + 4).to_s)
      end
    end
  end

  describe "#upload_from_basespace_to_s3" do
    let(:fake_basespace_path) { "fake_basespace_path" }
    let(:fake_s3_path) { "fake_s3_path" }
    let(:fake_file_name) { "fake_file_name" }

    context "upload happens successfully" do
      it "returns true" do
        expect(Syscall).to receive(:pipe).with(
          ["curl", "--fail", "-s", "--show-error", fake_basespace_path],
          ["aws", "s3", "cp", "-", "#{fake_s3_path}/#{fake_file_name}"]
        ).exactly(1).times.and_return([
                                        true, "",
                                      ])
        expect(LogUtil).to receive(:log_error).exactly(0).times

        success = helper.upload_from_basespace_to_s3(fake_basespace_path, fake_s3_path, fake_file_name)
        expect(success).to be true
      end
    end

    # SMP-1730: the stream is non-seekable, so the AWS CLI needs --expected-size
    # to plan a part size large enough for the full ~100 GB range. When the file
    # size is known it must be passed; when it is unknown the flag is omitted.
    context "when the file size is known" do
      it "passes --expected-size to aws s3 cp" do
        expect(Syscall).to receive(:pipe).with(
          ["curl", "--fail", "-s", "--show-error", fake_basespace_path],
          ["aws", "s3", "cp", "-", "#{fake_s3_path}/#{fake_file_name}", "--expected-size", "90000000000"]
        ).exactly(1).times.and_return([true, ""])

        success = helper.upload_from_basespace_to_s3(fake_basespace_path, fake_s3_path, fake_file_name, 90_000_000_000)
        expect(success).to be true
      end
    end

    context "when the file size is unknown" do
      it "omits --expected-size (nil size)" do
        expect(Syscall).to receive(:pipe).with(
          ["curl", "--fail", "-s", "--show-error", fake_basespace_path],
          ["aws", "s3", "cp", "-", "#{fake_s3_path}/#{fake_file_name}"]
        ).exactly(1).times.and_return([true, ""])

        success = helper.upload_from_basespace_to_s3(fake_basespace_path, fake_s3_path, fake_file_name, nil)
        expect(success).to be true
      end

      it "omits --expected-size (non-positive size)" do
        expect(Syscall).to receive(:pipe).with(
          ["curl", "--fail", "-s", "--show-error", fake_basespace_path],
          ["aws", "s3", "cp", "-", "#{fake_s3_path}/#{fake_file_name}"]
        ).exactly(1).times.and_return([true, ""])

        success = helper.upload_from_basespace_to_s3(fake_basespace_path, fake_s3_path, fake_file_name, 0)
        expect(success).to be true
      end
    end

    context "upload fails" do
      let(:fake_std_err) { "curl: (22) The requested URL returned error: 403 Forbidden" }

      it "returns true" do
        expect(Syscall).to receive(:pipe).with(
          ["curl", "--fail", "-s", "--show-error", fake_basespace_path],
          ["aws", "s3", "cp", "-", "#{fake_s3_path}/#{fake_file_name}"]
        ).exactly(1).times.and_return([
                                        false, fake_std_err,
                                      ])

        # If the syscall fails, we should log the error.
        expect(LogUtil).to receive(:log_error).with(
          "Failed to transfer file from basespace to #{fake_s3_path} for #{fake_file_name}: #{fake_std_err}",
          hash_including(basespace_paths: "fake_basespace_path", file_name: "fake_file_name", s3_path: "fake_s3_path")
        ).exactly(1).times

        success = helper.upload_from_basespace_to_s3(fake_basespace_path, fake_s3_path, fake_file_name)
        expect(success).to be false
      end
    end

    describe "#revoke_access_token" do
      let(:fake_access_token) { "fake_access_token" }

      it "should call DELETE basespace endpoint" do
        expect(HttpHelper).to receive(:delete).with(anything, "x-access-token" => fake_access_token).exactly(1).times

        BasespaceHelper.revoke_access_token(fake_access_token)
      end
    end

    describe "#verify_access_token_revoked" do
      let(:fake_access_token) { "fake_access_token" }

      it "should call Basespace API to test access token" do
        expect(HttpHelper).to receive(:get_json).with(anything, anything, { "Authorization" => "Bearer #{fake_access_token}" }, anything)
                                                .exactly(1).times.and_raise(HttpHelper::HttpError.new("HTTP Get request failed", 401))
        expect(LogUtil).to receive(:log_error).with(
          "BasespaceAccessTokenError: Failed to revoke access token for sample id 123abc",
          hash_including(
            basespace_token_fingerprint: SecretRedaction.fingerprint("fake_access_token"),
            sample_id: "123abc"
          )
        )
                                              .exactly(0).times
        expect(Rails.logger).to receive(:info).with("Revoke access token check succeeded").exactly(1).times

        BasespaceHelper.verify_access_token_revoked(fake_access_token, "123abc")
      end

      it "should log an error if Basespace API call unexpectedly succeeds" do
        expect(HttpHelper).to receive(:get_json).with(anything, anything, { "Authorization" => "Bearer #{fake_access_token}" }, anything)
                                                .exactly(1).times.and_return("foo" => "bar")
        expect(LogUtil).to receive(:log_error).with(
          "BasespaceAccessTokenError: Failed to revoke access token for sample id 123abc",
          hash_including(
            basespace_token_fingerprint: SecretRedaction.fingerprint("fake_access_token"),
            sample_id: "123abc"
          )
        )
                                              .exactly(1).times
        expect(Rails.logger).to receive(:info).with("Revoke access token check succeeded").exactly(0).times

        BasespaceHelper.verify_access_token_revoked(fake_access_token, "123abc")
      end
    end
  end

  # SMP-1729. LogUtil is deliberately NOT stubbed here: these examples assert on
  # the bytes that actually reach the log sink, which is the thing the ticket is
  # about. A BaseSpace access token is the USER'S Illumina credential, and a
  # BaseSpace HrefContent download path is a presigned URL, i.e. a bearer
  # credential for its validity window. Neither may appear in the output.
  describe "credential redaction in logged output" do
    # Obvious fakes -- nothing here is or resembles a real credential.
    let(:fake_token) { "fake-basespace-token-not-a-real-credential" }
    let(:fake_signed_path) do
      "https://basespace.example.invalid/files/sample_one.fastq.gz?X-Amz-Signature=fakesignaturevalue"
    end
    let(:log_output) { StringIO.new }
    let(:logged) { log_output.string }
    let(:expected_fingerprint) { SecretRedaction.fingerprint(fake_token) }

    before do
      allow(Rails).to receive(:logger).and_return(ActiveSupport::Logger.new(log_output))
    end

    shared_examples "a log line without the token" do |expected_message|
      it "logs the diagnostic but not the access token" do
        subject

        expect(logged).to include(expected_message)
        expect(logged).not_to include(fake_token)
        # A correlation id survives, so "which token failed" is still answerable.
        expect(logged).to include(expected_fingerprint)
      end
    end

    context "when fetching projects fails" do
      subject { helper.basespace_projects(fake_token) }

      before { allow(HttpHelper).to receive(:get_json).and_return({}) }

      include_examples "a log line without the token", "Failed to fetch Basespace projects"
    end

    context "when fetching projects raises" do
      subject { helper.basespace_projects(fake_token) }

      before { allow(HttpHelper).to receive(:get_json).and_raise(StandardError.new("net")) }

      include_examples "a log line without the token", "Failed to fetch Basespace projects"
    end

    context "when fetching samples for a project fails" do
      subject { helper.samples_for_basespace_project("p1", fake_token) }

      before { allow(HttpHelper).to receive(:get_json).and_return("ErrorMessage" => "bad") }

      include_examples "a log line without the token", "Fetch samples for Basespace project failed"
    end

    context "when fetching samples for a project raises" do
      subject { helper.samples_for_basespace_project("p1", fake_token) }

      before { allow(HttpHelper).to receive(:get_json).and_raise(StandardError.new("net")) }

      include_examples "a log line without the token", "Failed to fetch samples for Basespace project"
    end

    context "when fetching files for a dataset fails" do
      subject { helper.files_for_basespace_dataset("d1", fake_token) }

      before { allow(HttpHelper).to receive(:get_json).and_return("ErrorMessage" => "bad") }

      include_examples "a log line without the token", "Fetch files for Basespace dataset failed"
    end

    context "when fetching files for a dataset raises" do
      subject { helper.files_for_basespace_dataset("d1", fake_token) }

      before { allow(HttpHelper).to receive(:get_json).and_raise(StandardError.new("net")) }

      include_examples "a log line without the token", "Failed to fetch files for basespace dataset"
    end

    context "when the revoked-token check unexpectedly succeeds" do
      subject { BasespaceHelper.verify_access_token_revoked(fake_token, "123abc") }

      before { allow(HttpHelper).to receive(:get_json).and_return("foo" => "bar") }

      include_examples "a log line without the token", "Failed to revoke access token for sample id 123abc"
    end

    context "when the S3 transfer fails" do
      let(:curl_stderr) { "curl: (22) The requested URL returned error: 403 Forbidden for #{fake_signed_path}" }

      before do
        allow(Syscall).to receive(:pipe).and_return([false, curl_stderr])
      end

      it "logs the object path and the failure but not the presigned signature" do
        helper.upload_from_basespace_to_s3([fake_signed_path], "s3://bucket/path", "f.fastq")

        expect(logged).to include("403 Forbidden")
        expect(logged).to include("sample_one.fastq.gz")
        expect(logged).not_to include("fakesignaturevalue")
        expect(logged).not_to include("X-Amz-Signature")
      end
    end
  end
end

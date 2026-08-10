# frozen_string_literal: true

require "rails_helper"

# Coverage Wave 3: branch sweep for BasespaceHelper. Targets the else-branches
# where the provider omits a specific error message (generic-log path), the
# non-401 rescue re-raise, and the non-Array sort skip in
# upload_from_basespace_to_s3. Spec-only.
RSpec.describe BasespaceHelper, type: :helper do
  let(:access_token) { "token" }

  describe "#basespace_projects" do
    it "logs the generic message and returns nil when Items is nil with no ResponseStatus" do
      allow(HttpHelper).to receive(:get_json).and_return({})
      expect(LogUtil).to receive(:log_error).with(
        "Failed to fetch Basespace projects",
        hash_including(basespace_token_fingerprint: SecretRedaction.fingerprint(access_token))
      ).once

      expect(helper.basespace_projects(access_token)).to be_nil
    end

    it "logs the provider message when ResponseStatus.Message is present" do
      allow(HttpHelper).to receive(:get_json)
        .and_return("ResponseStatus" => { "Message" => "boom" })
      expect(LogUtil).to receive(:log_error).with(
        "Fetch Basespace projects failed with error: boom",
        hash_including(basespace_token_fingerprint: SecretRedaction.fingerprint(access_token))
      ).once

      expect(helper.basespace_projects(access_token)).to be_nil
    end

    it "returns nil and logs when the API raises (rescue branch)" do
      allow(HttpHelper).to receive(:get_json).and_raise(StandardError.new("net"))
      expect(LogUtil).to receive(:log_error).once

      expect(helper.basespace_projects(access_token)).to be_nil
    end

    it "maps id/name on success" do
      allow(HttpHelper).to receive(:get_json)
        .and_return("Response" => { "Items" => [{ "Id" => "9", "Name" => "P" }] })

      expect(helper.basespace_projects(access_token)).to eq([{ id: "9", name: "P" }])
    end
  end

  describe "#samples_for_basespace_project" do
    it "logs the generic message when Items is nil with no ErrorMessage" do
      allow(HttpHelper).to receive(:get_json).and_return({})
      expect(LogUtil).to receive(:log_error).with(
        "Failed to fetch samples for Basespace project",
        hash_including(project_id: "p1")
      ).once

      expect(helper.samples_for_basespace_project("p1", access_token)).to be_nil
    end

    it "logs the provider message when ErrorMessage is present" do
      allow(HttpHelper).to receive(:get_json).and_return("ErrorMessage" => "bad")
      expect(LogUtil).to receive(:log_error).with(
        "Fetch samples for Basespace project failed with error: bad",
        hash_including(project_id: "p1")
      ).once

      expect(helper.samples_for_basespace_project("p1", access_token)).to be_nil
    end

    it "drops non-FASTQ datasets via the file_type select" do
      allow(HttpHelper).to receive(:get_json).and_return(
        "Items" => [
          { "Id" => "1", "Name" => "s1", "TotalSize" => 10,
            "Project" => { "Name" => "proj" },
            "DatasetType" => { "Name" => "common.fastq" },
            "Attributes" => { "common_fastq" => { "IsPairedEnd" => true } }, },
          # Non-FASTQ -> get_dataset_file_type returns nil -> filtered out
          { "Id" => "2", "Name" => "s2", "TotalSize" => 20,
            "Project" => { "Name" => "proj" },
            "DatasetType" => { "Name" => "bam" }, },
        ]
      )

      result = helper.samples_for_basespace_project("p1", access_token)
      expect(result.size).to eq(1)
      expect(result.first[:file_type]).to eq("Paired-end FASTQ")
    end

    it "labels single-end FASTQ when IsPairedEnd is not true (the else in get_dataset_file_type)" do
      allow(HttpHelper).to receive(:get_json).and_return(
        "Items" => [
          { "Id" => "1", "Name" => "s1", "TotalSize" => 10,
            "Project" => { "Name" => "proj" },
            "DatasetType" => { "Name" => "fastq" },
            "Attributes" => { "common_fastq" => { "IsPairedEnd" => false } }, },
        ]
      )

      result = helper.samples_for_basespace_project("p1", access_token)
      expect(result.first[:file_type]).to eq("Single-end FASTQ")
    end
  end

  describe "#files_for_basespace_dataset" do
    it "logs the generic message when Items is nil with no ErrorMessage" do
      allow(HttpHelper).to receive(:get_json).and_return({})
      expect(LogUtil).to receive(:log_error).with(
        "Failed to fetch files for basespace dataset",
        hash_including(dataset_id: "d1")
      ).once

      expect(helper.files_for_basespace_dataset("d1", access_token)).to be_nil
    end
  end

  describe "#verify_access_token_revoked" do
    it "re-raises when the HTTP error is not a 401 (the rescue else)" do
      allow(HttpHelper).to receive(:get_json)
        .and_raise(HttpHelper::HttpError.new("boom", 500))

      expect do
        described_class.verify_access_token_revoked("tok", "sid")
      end.to raise_error(HttpHelper::HttpError)
    end
  end

  describe "#upload_from_basespace_to_s3" do
    it "does not call sort! when basespace_paths is a plain String (non-Array branch)" do
      expect(Syscall).to receive(:pipe).and_return([true, ""])

      success = helper.upload_from_basespace_to_s3("single_path", "s3://bucket", "f.fastq")
      expect(success).to be true
    end
  end
end

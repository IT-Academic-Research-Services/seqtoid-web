require 'rails_helper'

# The orchestrator only coordinates other (independently-tested) services, so its
# collaborators are stubbed: UserDataExportService writes the bundle,
# S3TransferDispatchService dispatches the file copy, and S3 uploads are stubbed.
RSpec.describe UserMigrationExportService do
  let(:user_id) { 4242 }
  let(:destination_bucket) { "partner-bucket" }
  let(:ts) { "20260804120000" }

  let(:transfer_job) { instance_double("S3TransferJob", id: 77, destination_bucket: destination_bucket, file_count: 42) }

  before do
    # Export writes a couple of bundle files into the dir it is handed.
    allow(UserDataExportService).to receive(:call) do |user_id:, output_dir:|
      File.write(File.join(output_dir, "manifest.json"), "{}")
      File.write(File.join(output_dir, "samples.ndjson.gz"), "x")
      { dir: output_dir, schema_version: "1.0", user_id: user_id,
        table_counts: { "samples" => 3 }, files: ["manifest.json", "samples.ndjson.gz"], warnings: [], }
    end

    allow(AwsClient).to receive(:[]).with(:s3).and_return(Aws::S3::Client.new(stub_responses: true))
    allow(S3TransferDispatchService).to receive(:call).and_return(transfer_job)
  end

  it "exports the bundle, uploads it to the destination bucket, dispatches the S3 transfer, and summarizes" do
    result = described_class.call(user_id, destination_bucket: destination_bucket, timestamp: ts)

    expect(UserDataExportService).to have_received(:call).with(user_id: user_id, output_dir: anything)
    expect(S3TransferDispatchService).to have_received(:call).with(user_id)

    expect(result[:schema_version]).to eq("1.0")
    expect(result[:table_counts]).to eq("samples" => 3)
    expect(result[:destination_bucket]).to eq(destination_bucket)
    expect(result[:bundle_s3_uri]).to eq("s3://#{destination_bucket}/user_data_exports/#{user_id}/migration_#{ts}")
    expect(result[:transfer_job_id]).to eq(77)
    expect(result[:transfer_file_count]).to eq(42)
  end

  it "skips the S3 transfer when run_transfer: false but still uploads the bundle to the destination bucket" do
    result = described_class.call(user_id, destination_bucket: destination_bucket, run_transfer: false, timestamp: ts)

    expect(S3TransferDispatchService).not_to have_received(:call)
    expect(result[:transfer_job_id]).to be_nil
    expect(result[:bundle_s3_uri]).to eq("s3://#{destination_bucket}/user_data_exports/#{user_id}/migration_#{ts}")
  end

  it "raises when no destination bucket is configured" do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("S3_TRANSFER_DESTINATION_BUCKET").and_return(nil)

    expect { described_class.call(user_id, destination_bucket: nil) }
      .to raise_error(UserMigrationExportService::DestinationBucketMissingError)
  end
end

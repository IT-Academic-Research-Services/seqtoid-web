require "rails_helper"

RSpec.describe SetDefaultWorkflowVersionService do
  let(:s3) { instance_double("Aws::S3::Client") }

  before do
    allow(AwsClient).to receive(:[]).with(:s3).and_return(s3)
    allow(AppConfigHelper).to receive(:get_workflow_version).with("short-read-mngs").and_return("8.3.15")
    allow(AppConfigHelper).to receive(:set_workflow_version)
  end

  it "verifies the WDL bundle, sets the default, and returns previous -> new" do
    allow(s3).to receive(:get_object).and_return({ content_length: 37_020 })

    result = described_class.call(workflow: "short-read-mngs", version: "8.3.16")

    expect(result.ok).to be true
    expect(result.previous).to eq("8.3.15")
    expect(AppConfigHelper).to have_received(:set_workflow_version).with("short-read-mngs", "8.3.16")
  end

  it "checks the short-read-mngs entrypoint (host_filter.wdl) in the workflows bucket" do
    expect(s3).to receive(:get_object)
      .with(bucket: S3_WORKFLOWS_BUCKET, key: "short-read-mngs-v8.3.16/host_filter.wdl")
      .and_return({ content_length: 1 })

    described_class.call(workflow: "short-read-mngs", version: "8.3.16")
  end

  it "does NOT flip when the bundle is missing (NoSuchKey), fail closed" do
    allow(s3).to receive(:get_object).and_raise(Aws::S3::Errors::NoSuchKey.new(nil, "missing"))

    result = described_class.call(workflow: "short-read-mngs", version: "8.3.16")

    expect(result.ok).to be false
    expect(result.error).to match(/not found/)
    expect(AppConfigHelper).not_to have_received(:set_workflow_version)
  end

  it "does NOT flip when the bundle object is empty" do
    allow(s3).to receive(:get_object).and_return({ content_length: 0 })

    result = described_class.call(workflow: "short-read-mngs", version: "8.3.16")

    expect(result.ok).to be false
    expect(AppConfigHelper).not_to have_received(:set_workflow_version)
  end

  it "is idempotent -- re-setting the current version still succeeds" do
    allow(AppConfigHelper).to receive(:get_workflow_version).with("short-read-mngs").and_return("8.3.16")
    allow(s3).to receive(:get_object).and_return({ content_length: 10 })

    result = described_class.call(workflow: "short-read-mngs", version: "8.3.16")

    expect(result.ok).to be true
    expect(result.previous).to eq("8.3.16")
    expect(AppConfigHelper).to have_received(:set_workflow_version).with("short-read-mngs", "8.3.16")
  end
end

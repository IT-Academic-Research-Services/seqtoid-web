require 'rails_helper'

# seqtoid-cli `upload-samples --resume`: POST /samples/resume_upload_targets re-attaches a CLI batch to the
# samples it created but never finished uploading, instead of creating new (name-clashing) samples.
RSpec.describe "POST /samples/resume_upload_targets", type: :request do
  create_users

  let(:project) { create(:project, users: [@joe]) }

  before do
    sign_in @joe
    allow_any_instance_of(InputFile).to receive(:multipart_upload_id).and_return(nil)
    allow_any_instance_of(InputFile).to receive(:s3_presence_check).and_return(false)
  end

  def resume(names, project_id: project.id)
    post "/samples/resume_upload_targets.json", params: { project_id: project_id, sample_names: names }
    JSON.parse(response.body)
  end

  it "returns upload targets for a still-created sample the user uploaded" do
    sample = create(:sample, project: project, user: @joe, name: "S1", status: Sample::STATUS_CREATED)

    body = resume(["S1"])

    expect(response).to have_http_status(:ok)
    expect(body["errors"]).to eq({})
    target = body["samples"].sole
    expect(target["id"]).to eq(sample.id)
    expect(target["input_files"].length).to eq(2)
    expect(target["input_files"].first).to include("s3_path", "source", "multipart_upload_id", "uploaded" => false)
  end

  it "reports per-file S3 presence and the in-progress multipart upload id" do
    create(:sample, project: project, user: @joe, name: "S1", status: Sample::STATUS_CREATED)
    allow_any_instance_of(InputFile).to receive(:s3_presence_check).and_return(true)
    allow_any_instance_of(InputFile).to receive(:multipart_upload_id).and_return("mpu-123")

    file = resume(["S1"])["samples"].sole["input_files"].first
    expect(file["uploaded"]).to be(true)
    expect(file["multipart_upload_id"]).to eq("mpu-123")
  end

  it "matches names case-insensitively" do
    create(:sample, project: project, user: @joe, name: "Sample_A", status: Sample::STATUS_CREATED)
    expect(resume(["sample_a"])["samples"].length).to eq(1)
  end

  it "reopens a sample the stalled-upload sweep failed before processing started" do
    sample = create(:sample, project: project, user: @joe, name: "S1", status: Sample::STATUS_CHECKED,
                             upload_error: Sample::UPLOAD_ERROR_LOCAL_UPLOAD_FAILED)

    body = resume(["S1"])

    expect(body["samples"].sole["id"]).to eq(sample.id)
    sample.reload
    expect(sample.status).to eq(Sample::STATUS_CREATED)
    expect(sample.upload_error).to be_nil
  end

  it "resets the failed workflow run of a reopened sample" do
    sample = create(:sample, project: project, user: @joe, name: "S1", status: Sample::STATUS_CHECKED,
                             upload_error: Sample::UPLOAD_ERROR_LOCAL_UPLOAD_FAILED)
    run = create(:workflow_run, sample: sample, status: WorkflowRun::STATUS[:failed])

    resume(["S1"])
    expect(run.reload.status).to eq(WorkflowRun::STATUS[:created])
  end

  it "refuses (and leaves alone) a sample that is already uploaded" do
    create(:sample, project: project, user: @joe, name: "S1", status: Sample::STATUS_CHECKED)

    body = resume(["S1"])
    expect(body["samples"]).to eq([])
    expect(body["errors"]["S1"]).to eq("already uploaded")
  end

  it "refuses a failed upload once processing has started" do
    sample = create(:sample, project: project, user: @joe, name: "S1", status: Sample::STATUS_CHECKED,
                             upload_error: Sample::UPLOAD_ERROR_LOCAL_UPLOAD_FAILED)
    create(:pipeline_run, sample: sample)

    body = resume(["S1"])
    expect(body["errors"]["S1"]).to include("delete the sample and upload it again")
    expect(sample.reload.status).to eq(Sample::STATUS_CHECKED)
  end

  it "never returns another user's sample, even in a shared project" do
    shared = create(:project, users: [@joe, @admin])
    create(:sample, project: shared, user: @admin, name: "S1", status: Sample::STATUS_CREATED)

    body = resume(["S1"], project_id: shared.id)
    expect(body["samples"]).to eq([])
    expect(body["errors"]["S1"]).to include("no sample with this name that you uploaded")
  end

  it "reports a name with no sample" do
    expect(resume(["missing"])["errors"]["missing"]).to include("no sample with this name")
  end

  it "rejects more names than the upload limit" do
    stub_const("SamplesController::SAMPLE_UPLOAD_LIMIT", 2)
    resume(%w[a b c])
    expect(response).to have_http_status(:bad_request)
  end
end

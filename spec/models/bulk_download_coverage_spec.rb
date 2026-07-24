require 'rails_helper'

# Supplementary coverage for BulkDownload (Coverage Wave 4b).
#
# The #kickoff_ecs_task failure branch previously surfaced in live Sentry
# (ucsf-rm, dev) as a RuntimeError whose message embedded a Python
# "Traceback ..." string carried straight through from the shelled-out
# aegea/s3_tar_writer stderr. #532 fixes this: the raw stderr is now logged (for
# debugging) and a typed BulkDownload::KickoffError is raised with a clean,
# human-readable message instead of the raw traceback.
RSpec.describe BulkDownload, type: :model do
  create_users

  let(:python_traceback_stderr) do
    <<~STDERR
      Traceback (most recent call last):
        File "s3_tar_writer.py", line 42, in <module>
          main()
        File "s3_tar_writer.py", line 30, in main
          raise ValueError("boom")
      ValueError: boom
    STDERR
  end

  describe "#kickoff_ecs_task (failure branch)" do
    let(:bulk_download) { create(:bulk_download, user: @joe, download_type: "sample_overview", status: BulkDownload::STATUS_WAITING) }
    let(:failed_status) { instance_double(Process::Status, exitstatus: 1) }

    before do
      # Avoid touching the real filesystem/tempfiles + aegea command construction.
      allow(bulk_download).to receive(:aegea_ecs_submit_command).and_return(["aegea", "ecs", "run"])
      allow(AegeaRetry).to receive(:capture3).and_return(["", python_traceback_stderr, failed_status])
    end

    it "raises a typed KickoffError with a clean message, not the raw Python traceback" do
      allow(LogUtil).to receive(:log_error)
      expect { bulk_download.kickoff_ecs_task(["echo", "hi"]) }
        .to raise_error(BulkDownload::KickoffError, BulkDownloadsHelper::KICKOFF_FAILURE)
    end

    it "logs the raw stderr for debugging without surfacing it in the raised error" do
      expect(LogUtil).to receive(:log_error).with(
        a_string_matching(/Traceback \(most recent call last\)/),
        hash_including(bulk_download_id: bulk_download.id)
      )
      expect { bulk_download.kickoff_ecs_task(["echo", "hi"]) }
        .to raise_error(BulkDownload::KickoffError) { |e| expect(e.message).not_to include("Traceback") }
    end

    it "marks the download errored with the kickoff-failure message before raising" do
      allow(LogUtil).to receive(:log_error)
      expect { bulk_download.kickoff_ecs_task(["echo", "hi"]) }.to raise_error(BulkDownload::KickoffError)
      bulk_download.reload
      expect(bulk_download.status).to eq(BulkDownload::STATUS_ERROR)
      expect(bulk_download.error_message).to eq(BulkDownloadsHelper::KICKOFF_FAILURE)
    end
  end

  describe "#kickoff_ecs_task (success branch)" do
    let(:bulk_download) { create(:bulk_download, user: @joe, download_type: "sample_overview", status: BulkDownload::STATUS_WAITING) }
    let(:ok_status) { instance_double(Process::Status, exitstatus: 0) }

    before do
      allow(bulk_download).to receive(:aegea_ecs_submit_command).and_return(["aegea", "ecs", "run"])
      allow(AegeaRetry).to receive(:capture3).and_return([{ "taskArn" => "arn:aws:ecs:task/abc" }.to_json, "", ok_status])
    end

    it "records the task arn and marks the download running" do
      bulk_download.kickoff_ecs_task(["echo", "hi"])
      bulk_download.reload
      expect(bulk_download.ecs_task_arn).to eq("arn:aws:ecs:task/abc")
      expect(bulk_download.status).to eq(BulkDownload::STATUS_RUNNING)
    end
  end

  # Migration off aegea -> AWS Batch (#846/SMP-1477). kickoff now submits the s3_tar_writer
  # command straight to Batch as a container override; same RUNNING/ERROR semantics.
  describe "#kickoff_batch_job (success branch)" do
    let(:bulk_download) { create(:bulk_download, user: @joe, download_type: "sample_overview", status: BulkDownload::STATUS_WAITING) }

    it "submits to Batch (stringifying the command) and records the job arn + RUNNING" do
      expect(BATCH_CLIENT).to receive(:submit_job).with(
        hash_including(
          job_queue: BulkDownload::BULK_DOWNLOAD_BATCH_JOB_QUEUE,
          job_definition: BulkDownload::BULK_DOWNLOAD_BATCH_JOB_DEFINITION,
          # The Integer element (15) must be stringified -- Batch rejects non-String command args.
          container_overrides: { command: ["python", "s3_tar_writer.py", "--progress-delay", "15"] }
        )
      ).and_return(double("SubmitJobResponse", job_arn: "arn:aws:batch:us-west-2:1:job/xyz"))

      # command carries a raw Integer (like PROGRESS_UPDATE_DELAY) -- must not blow up submit_job.
      bulk_download.kickoff_batch_job(["python", "s3_tar_writer.py", "--progress-delay", 15])
      bulk_download.reload
      expect(bulk_download.ecs_task_arn).to eq("arn:aws:batch:us-west-2:1:job/xyz")
      expect(bulk_download.status).to eq(BulkDownload::STATUS_RUNNING)
    end
  end

  describe "#kickoff_batch_job (failure branch)" do
    let(:bulk_download) { create(:bulk_download, user: @joe, download_type: "sample_overview", status: BulkDownload::STATUS_WAITING) }

    before do
      allow(BATCH_CLIENT).to receive(:submit_job).and_raise(Aws::Errors::ServiceError.new(nil, "AccessDenied: not authorized"))
    end

    it "marks the download errored and raises a typed KickoffError" do
      allow(LogUtil).to receive(:log_error)
      expect { bulk_download.kickoff_batch_job(["python", "s3_tar_writer.py"]) }
        .to raise_error(BulkDownload::KickoffError, BulkDownloadsHelper::KICKOFF_FAILURE)
      bulk_download.reload
      expect(bulk_download.status).to eq(BulkDownload::STATUS_ERROR)
      expect(bulk_download.error_message).to eq(BulkDownloadsHelper::KICKOFF_FAILURE)
    end

    it "logs the underlying Batch error for debugging" do
      expect(LogUtil).to receive(:log_error).with(
        a_string_matching(/Batch submit_job failed/),
        hash_including(bulk_download_id: bulk_download.id)
      )
      expect { bulk_download.kickoff_batch_job(["python", "s3_tar_writer.py"]) }.to raise_error(BulkDownload::KickoffError)
    end
  end

  # The live launcher: a K8s Job on the dedicated warm node (#846/SMP-1477). Same RUNNING/ERROR
  # semantics; stores the Job name; command stringified.
  describe "#kickoff_k8s_job (success branch)" do
    let(:bulk_download) { create(:bulk_download, user: @joe, download_type: "sample_overview", status: BulkDownload::STATUS_WAITING) }

    it "creates a K8s Job (stringified command) and records the Job name + RUNNING" do
      job_client = instance_double(KubeJobClient)
      allow(KubeJobClient).to receive(:new).and_return(job_client)
      expect(job_client).to receive(:create_job) do |manifest|
        cmd = manifest.dig(:spec, :template, :spec, :containers, 0, :command)
        expect(cmd).to all(be_a(String)) # Integer args (PROGRESS_UPDATE_DELAY) must be stringified
        { "metadata" => { "name" => "bulk-download-#{bulk_download.id}" } }
      end

      bulk_download.kickoff_k8s_job(["python", "s3_tar_writer.py", "--progress-delay", 15])
      bulk_download.reload
      expect(bulk_download.ecs_task_arn).to eq("bulk-download-#{bulk_download.id}")
      expect(bulk_download.status).to eq(BulkDownload::STATUS_RUNNING)
    end
  end

  describe "#kickoff_k8s_job (failure branch)" do
    let(:bulk_download) { create(:bulk_download, user: @joe, download_type: "sample_overview", status: BulkDownload::STATUS_WAITING) }

    before do
      allow(KubeJobClient).to receive(:new).and_raise(KubeJobClient::Error, "create job -> 403 Forbidden")
    end

    it "marks the download errored and raises a typed KickoffError" do
      allow(LogUtil).to receive(:log_error)
      expect { bulk_download.kickoff_k8s_job(["python", "s3_tar_writer.py"]) }
        .to raise_error(BulkDownload::KickoffError, BulkDownloadsHelper::KICKOFF_FAILURE)
      bulk_download.reload
      expect(bulk_download.status).to eq(BulkDownload::STATUS_ERROR)
      expect(bulk_download.error_message).to eq(BulkDownloadsHelper::KICKOFF_FAILURE)
    end

    it "logs the underlying K8s error for debugging" do
      expect(LogUtil).to receive(:log_error).with(
        a_string_matching(/K8s Job create failed/),
        hash_including(bulk_download_id: bulk_download.id)
      )
      expect { bulk_download.kickoff_k8s_job(["python", "s3_tar_writer.py"]) }.to raise_error(BulkDownload::KickoffError)
    end
  end

  # Sentry DEV-RAILS-PROJECT-28 (#851): access_token is single-use -- the success/error callbacks null
  # it once the download is terminal. Rebuilding the callback urls then generated a path with a nil
  # token, which cannot match the :access_token route segment -> opaque UrlGenerationError.
  describe "callback urls when the access_token has been nulled" do
    let(:bulk_download) { create(:bulk_download, user: @joe, download_type: "sample_overview", status: BulkDownload::STATUS_WAITING) }

    before { allow(bulk_download).to receive(:server_host).and_return("https://dev.example.org") }

    it "returns working urls while the token is present" do
      expect(bulk_download.access_token).to be_present
      expect(bulk_download.success_url).to include("https://dev.example.org")
      expect(bulk_download.error_url).to be_present
      expect(bulk_download.progress_url).to be_present
    end

    it "returns nil instead of raising UrlGenerationError once the token is nulled" do
      bulk_download.update!(access_token: nil)
      expect { bulk_download.success_url }.not_to raise_error
      expect(bulk_download.success_url).to be_nil
      expect(bulk_download.error_url).to be_nil
      expect(bulk_download.progress_url).to be_nil
    end
  end
end

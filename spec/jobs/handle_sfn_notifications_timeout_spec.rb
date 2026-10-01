require "rails_helper"

RSpec.describe HandleSfnNotificationsTimeout, type: :job do
  subject { HandleSfnNotificationsTimeout.perform }

  describe "#perform" do
    let(:project) { create(:project) }
    let(:sample) { create(:sample, project: project) }

    let(:run1) { create(:workflow_run, sample: sample, status: WorkflowRun::STATUS[:running], executed_at: 5.hours.ago) }
    let(:run2) { create(:workflow_run, sample: sample, status: WorkflowRun::STATUS[:succeeded], executed_at: 25.hours.ago) }
    let(:run3) { create(:workflow_run, sample: sample, status: WorkflowRun::STATUS[:running], executed_at: 25.hours.ago) }
    let(:run4) { create(:workflow_run, sample: sample, status: WorkflowRun::STATUS[:running], executed_at: 2.days.ago) }

    # job_status for run5 and run7 will be set using run.format_job_status_text in the test
    let(:run5) { create(:pipeline_run, sample: sample, executed_at: 5.hours.ago) }
    let(:run6) { create(:pipeline_run, sample: sample, job_status: PipelineRun::STATUS_CHECKED, executed_at: 25.hours.ago, finalized: 1) }
    let(:run7) { create(:pipeline_run, sample: sample, executed_at: 25.hours.ago) }

    context "when there are no overdue runs" do
      it "does nothing" do
        _ = [run1, run2, run5, run6]
        # Setting the run5's job_status using run.format_job_status_text; in practice, this is how job_status gets set by update_job_status/async_update_job_status.
        run5_job_status = run5.send(:format_job_status_text, run5.active_stage.step_number, run5.active_stage.name, PipelineRun::STATUS_RUNNING, run5.report_ready?)
        run5.update(job_status: run5_job_status)

        expect(subject).to eq(0)
        expect(run1.reload.status).to eq(WorkflowRun::STATUS[:running])
        expect(run2.reload.status).to eq(WorkflowRun::STATUS[:succeeded])
        expect(run5.reload.job_status).to eq(run5_job_status)
        expect(run6.reload.job_status).to eq(PipelineRun::STATUS_CHECKED)
      end
    end

    context "when there are overdue runs" do
      it "marks overdue workflow runs as failed" do
        _ = [run1, run2, run3, run4]

        expect(CloudWatchUtil).to receive(:put_metric_data)

        expect(subject).to eq(2)

        expect(run1.reload.status).to eq(WorkflowRun::STATUS[:running])
        expect(run2.reload.status).to eq(WorkflowRun::STATUS[:succeeded])
        expect(run3.reload.status).to eq(WorkflowRun::STATUS[:failed])
        expect(run4.reload.status).to eq(WorkflowRun::STATUS[:failed])
      end

      it "marks overdue pipeline runs as failed" do
        AppConfigHelper.set_app_config(AppConfig::ENABLE_SFN_NOTIFICATIONS, "1")
        _ = [run5, run6, run7]
        # Setting the job_status using run.format_job_status_text; in practice, this is how job_status gets set by update_job_status/async_update_job_status.
        run5_job_status = run5.send(:format_job_status_text, run5.active_stage.step_number, run5.active_stage.name, PipelineRun::STATUS_RUNNING, run5.report_ready?)
        run5.update(job_status: run5_job_status)

        run7_job_status = run5.send(:format_job_status_text, run5.active_stage.step_number, run5.active_stage.name, PipelineRun::STATUS_RUNNING, run5.report_ready?)
        run7.update(job_status: run7_job_status)

        expect(CloudWatchUtil).to receive(:put_metric_data)

        expect(subject).to eq(1)

        expect(run5.reload.job_status).to eq(run5_job_status)
        expect(run6.reload.job_status).to eq(PipelineRun::STATUS_CHECKED)
        expect(run7.reload.job_status).to eq(PipelineRun::STATUS_FAILED)
        expect(run7.reload.results_finalized?).to eq(true)
      end
    end

    context "when an overdue pipeline run's SFN execution is in another AWS account" do
      # e.g. a run imported from CZ ID while it was still processing there: we can never read its execution.
      let(:foreign_run) do
        create(:pipeline_run, sample: sample, executed_at: 2.days.ago,
                              sfn_execution_arn: "arn:aws:states:us-west-2:745463180746:execution:idseq-swipe-prod-short-read-mngs-wdl:x")
      end

      before do
        allow(ENV).to receive(:[]).and_call_original
        allow(ENV).to receive(:[]).with("AWS_ACCOUNT_ID").and_return("283694049553")
        allow(CloudWatchUtil).to receive(:put_metric_data)
      end

      it "marks it failed with the rerun message, without reading the execution" do
        run_status = foreign_run.send(:format_job_status_text, foreign_run.active_stage.step_number, foreign_run.active_stage.name, PipelineRun::STATUS_RUNNING, foreign_run.report_ready?)
        foreign_run.update(job_status: run_status)
        expect_any_instance_of(PipelineRun).not_to receive(:check_for_user_error)

        expect(subject).to eq(1)

        foreign_run.reload
        expect(foreign_run.job_status).to eq(PipelineRun::STATUS_FAILED)
        expect(foreign_run.finalized).to eq(1)
        expect(foreign_run.results_finalized).to eq(PipelineRun::FINALIZED_FAIL)
        expect(foreign_run.error_message).to eq(HandleSfnNotificationsTimeout::FOREIGN_RUN_MESSAGE)
      end
    end

    context "when timing out one record raises" do
      it "logs it and still times out the others" do
        _ = [run3, run4]
        allow(CloudWatchUtil).to receive(:put_metric_data)
        allow_any_instance_of(WorkflowRun).to receive(:update_status).and_wrap_original do |original, *args, **kwargs|
          raise Aws::States::Errors::AccessDeniedException.new(nil, "not authorized") if original.receiver.id == run3.id

          original.call(*args, **kwargs)
        end
        expect(LogUtil).to receive(:log_error).with(a_string_matching(/could not time out WorkflowRun #{run3.id}/), hash_including(record_id: run3.id)).once

        expect { subject }.not_to raise_error

        expect(run3.reload.status).to eq(WorkflowRun::STATUS[:running])
        expect(run4.reload.status).to eq(WorkflowRun::STATUS[:failed])
      end
    end
  end
end

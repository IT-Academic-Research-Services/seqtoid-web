# Logs: This runs within resque. To find the logs, go to ecs-log-{env} ->
# idseq-resque/idseq-resque/* log streams.
#
# See also HandleSfnNotifications. This job is meant as a fail-safe in case we
# never receive or miss a notification.

require './lib/cloudwatch_util'

class HandleSfnNotificationsTimeout
  extend InstrumentedJob

  @queue = :handle_sfn_notifications_timeout

  MAX_RUNTIME ||= 24.hours.freeze

  # Shown to users on a run whose Step Functions execution lives in ANOTHER AWS account -- in practice a
  # run imported from CZ ID while it was still processing there. That execution can never notify us and
  # this env cannot read it, so the run is closed out as failed without calling Step Functions.
  FOREIGN_RUN_MESSAGE ||= "This run was imported from CZ ID while it was still processing there, and that " \
                          "processing could not be completed after the move to SeqtoID. Please rerun the sample.".freeze

  def self.perform
    Rails.logger.info("Starting HandleSfnNotificationsTimeout job...")

    overdue_workflow_runs = WorkflowRun.where(status: WorkflowRun::STATUS[:running]).where("executed_at < ?", MAX_RUNTIME.ago)
    if overdue_workflow_runs.present?
      overdue_workflow_runs.each do |wr|
        isolate(wr) do
          # Alert is sent within update_status. This is the 24h fail-safe for
          # lost/stuck runs, so do not auto-restart -- just mark it failed.
          wr.update_status(WorkflowRun::STATUS[:failed], allow_auto_restart: false)
          Rails.logger.info("Marked WorkflowRun #{wr.id} as failed due to timeout.")
        end
      end
    end

    overdue_pipeline_runs = PipelineRun.in_progress.where("executed_at < ?", MAX_RUNTIME.ago)
    if overdue_pipeline_runs.present?
      overdue_pipeline_runs.each do |pr|
        isolate(pr) { timeout_pipeline_run(pr) }
      end
    end

    overdue_trees = PhyloTreeNg.where(status: WorkflowRun::STATUS[:running]).where("executed_at < ?", MAX_RUNTIME.ago)
    if overdue_trees.present?
      overdue_trees.each do |pt|
        isolate(pt) do
          # Alert is sent within update_status:
          pt.update_status(WorkflowRun::STATUS[:failed])
          Rails.logger.info("Marked PhyloTreeNg #{pt.id} as failed due to timeout.")
        end
      end
    end

    if overdue_workflow_runs.present? || overdue_pipeline_runs.present? || overdue_trees.present?
      dimensions = [
        { name: "EventName", value: "SfnNotificationsTimeout" },
      ]
      metric_data = [
        CloudWatchUtil.create_metric_datum("Event occurrences", overdue_workflow_runs.size + overdue_pipeline_runs.size + overdue_trees.size, "Count", dimensions),
      ]
      CloudWatchUtil.put_metric_data("#{Rails.env}-sfn-notifications-timeout-count", metric_data)
    end

    return overdue_workflow_runs.size + overdue_pipeline_runs.size + overdue_trees.size
  end

  def self.timeout_pipeline_run(pr)
    if foreign_execution?(pr.sfn_execution_arn)
      fail_foreign_pipeline_run(pr)
      return
    end

    prs = pr.active_stage
    if prs.nil?
      # All stages succeeded.
      pr.finalized = 1
      pr.time_to_finalized = pr.send(:time_since_executed_at)
      pr.job_status = PipelineRun::STATUS_CHECKED
      pr.save
    else
      pr.job_status = PipelineRun::STATUS_FAILED
      pr.finalized = 1
      pr.time_to_finalized = pr.send(:time_since_executed_at)
      pr.known_user_error, pr.error_message = pr.check_for_user_error(prs)
      automatic_restart = pr.automatic_restart_allowed? unless pr.known_user_error
      # Alert is sent within report_failed_pipeline_run_stage:
      pr.send(:report_failed_pipeline_run_stage, prs, pr.known_user_error, automatic_restart)
      pr.save
      pr.monitor_results
      Rails.logger.info("Marked PipelineRun #{pr.id} as failed due to timeout.")
    end
  end

  # One bad record must never abort the whole sweep (a single unreadable execution used to stop every
  # other overdue run from being timed out): log + report it to Sentry, then move on.
  def self.isolate(record)
    yield
  rescue StandardError => e
    LogUtil.log_error(
      "HandleSfnNotificationsTimeout: could not time out #{record.class.name} #{record.id}; skipping it",
      exception: e,
      record_id: record.id,
      record_type: record.class.name
    )
  end

  # True when the execution ARN names a different AWS account than this environment's own.
  def self.foreign_execution?(arn)
    run_account = arn.to_s.split(":")[4].to_s
    our_account = ENV["AWS_ACCOUNT_ID"].to_s
    run_account.present? && our_account.present? && run_account != our_account
  end

  def self.fail_foreign_pipeline_run(pr)
    pr.pipeline_run_stages.where(job_status: "RUNNING").find_each do |stage|
      stage.update!(job_status: PipelineRunStage::STATUS_FAILED)
    end
    pr.update!(
      job_status: PipelineRun::STATUS_FAILED,
      finalized: 1,
      results_finalized: PipelineRun::FINALIZED_FAIL,
      error_message: FOREIGN_RUN_MESSAGE,
      time_to_finalized: pr.send(:time_since_executed_at)
    )
    Rails.logger.info("Marked PipelineRun #{pr.id} as failed: its SFN execution is in another AWS account.")
  end
end

# frozen_string_literal: true

# Per-user cap on concurrently running mNGS pipeline runs, so one bulk upload cannot fill the shared AWS
# Batch queues and starve everyone else (the swipe queues are FIFO). Off unless
# AppConfig::MAX_ACTIVE_PIPELINE_RUNS_PER_USER is a positive integer.
#
# A run that would push its uploader over the cap is not dispatched: it is marked deferred
# (PipelineRun#defer_dispatch!) and ReleaseDeferredPipelineRuns starts it, oldest first, once the user's
# earlier runs finish. Admin users are exempt (operational re-runs).
module PipelineDispatchThrottle
  module_function

  # The configured cap, or nil when there is none.
  def cap
    value = Integer(AppConfigHelper.get_app_config(AppConfig::MAX_ACTIVE_PIPELINE_RUNS_PER_USER).to_s.strip, exception: false)
    value&.positive? ? value : nil
  end

  # Dispatched (has an SFN execution), unfinished, current runs on samples the user uploaded.
  def active_count(user_id)
    PipelineRun.joins(:sample)
               .where(samples: { user_id: user_id })
               .where(finalized: 0, deprecated: [false, nil])
               .where.not(sfn_execution_arn: nil)
               .count
  end

  # True when this run must wait. Never touches the run when no cap is configured.
  def defer?(pipeline_run)
    limit = cap
    return false if limit.nil?

    user = pipeline_run.sample&.user
    return false if user.nil? || user.admin?

    active_count(user.id) >= limit
  end
end

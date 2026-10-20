# frozen_string_literal: true

# Per-user cap on concurrently running pipeline runs -- mNGS PipelineRuns and consensus-genome / AMR
# WorkflowRuns, counted together -- so one bulk upload cannot fill the shared AWS Batch queues and starve
# everyone else (the swipe queues are FIFO). Off unless AppConfig::MAX_ACTIVE_PIPELINE_RUNS_PER_USER is a
# positive integer.
#
# A run that would push its user over the cap is not dispatched: it is marked deferred (#defer_dispatch!,
# shown as "Queued") and ReleaseDeferredPipelineRuns starts it, oldest first, once the user's earlier runs
# finish. Admin users are exempt (operational re-runs).
module PipelineDispatchThrottle
  module_function

  # The configured cap, or nil when there is none.
  def cap
    value = Integer(AppConfigHelper.get_app_config(AppConfig::MAX_ACTIVE_PIPELINE_RUNS_PER_USER).to_s.strip, exception: false)
    value&.positive? ? value : nil
  end

  # The user a run counts against: a workflow run's initiator (falling back to the sample owner), or an mNGS
  # run's sample owner.
  def user_id_for(run)
    run.is_a?(WorkflowRun) ? (run.user_id || run.sample&.user_id) : run.sample&.user_id
  end

  # Dispatched, unfinished, current runs counted against the user: mNGS runs on samples they uploaded (has an
  # SFN execution, not finalized, not deprecated) plus consensus-genome / AMR runs they started (RUNNING).
  def active_count(user_id)
    pipeline_runs = PipelineRun.joins(:sample)
                               .where(samples: { user_id: user_id })
                               .where(finalized: 0, deprecated: [false, nil])
                               .where.not(sfn_execution_arn: nil)
                               .count
    workflow_runs = WorkflowRun.where(user_id: user_id, status: WorkflowRun::STATUS[:running], deprecated: false)
                               .where(workflow: WorkflowRun::CAPPED_WORKFLOWS)
                               .count
    pipeline_runs + workflow_runs
  end

  # True when this run must wait. Never touches the run when no cap is configured.
  def defer?(run)
    limit = cap
    return false if limit.nil?

    user = User.find_by(id: user_id_for(run))
    return false if user.nil? || user.admin?

    active_count(user.id) >= limit
  end
end

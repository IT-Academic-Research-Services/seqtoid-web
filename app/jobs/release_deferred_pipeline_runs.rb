# frozen_string_literal: true

# Starts runs held back by the per-user concurrent-run cap (PipelineDispatchThrottle) -- mNGS pipeline runs
# and consensus-genome / AMR workflow runs -- oldest first per user, as each user's earlier runs finish.
# Scheduled every 2 minutes. With no cap configured it releases every deferred run (so removing the cap
# drains the backlog); with nothing deferred it is two indexed queries.
class ReleaseDeferredPipelineRuns
  extend InstrumentedJob

  @queue = :q03_pipeline_run

  def self.perform
    new.run
  end

  def run
    rows = deferred_rows
    return 0 if rows.empty?

    cap = PipelineDispatchThrottle.cap
    released = 0
    rows.group_by(&:first).each do |user_id, user_rows|
      headroom = cap ? cap - PipelineDispatchThrottle.active_count(user_id) : user_rows.size
      next if headroom <= 0

      user_rows.sort_by { |(_, at, _, id)| [at, id] }.first(headroom).each do |(_, _, klass, id)|
        released += 1 if release(klass, id)
      end
    end
    Rails.logger.info("[ReleaseDeferredPipelineRuns] deferred=#{rows.size} released=#{released} cap=#{cap.inspect}")
    released
  end

  private

  # [user_id, deferred_at, class, id] for every deferred run, using the same user attribution as the throttle.
  def deferred_rows
    prs = PipelineRun.dispatch_deferred.joins(:sample)
                     .pluck("samples.user_id", "pipeline_runs.dispatch_deferred_at", "pipeline_runs.id")
                     .map { |uid, at, id| [uid, at, PipelineRun, id] }
    wrs = WorkflowRun.dispatch_deferred.joins(:sample)
                     .pluck(Arel.sql("COALESCE(workflow_runs.user_id, samples.user_id)"), "workflow_runs.dispatch_deferred_at", "workflow_runs.id")
                     .map { |uid, at, id| [uid, at, WorkflowRun, id] }
    prs + wrs
  end

  def release(klass, id)
    run = klass.find_by(id: id)
    run ? run.release_deferred_dispatch! : false
  rescue StandardError => e
    LogUtil.log_error("[ReleaseDeferredPipelineRuns] failed to release #{klass.name} #{id}", exception: e,
                                                                                             run_id: id)
    false
  end
end

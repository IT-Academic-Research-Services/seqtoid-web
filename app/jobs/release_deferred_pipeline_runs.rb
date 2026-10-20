# frozen_string_literal: true

# Starts pipeline runs held back by the per-user concurrent-run cap (PipelineDispatchThrottle), oldest first,
# as each user's earlier runs finish. Scheduled every 2 minutes. With no cap configured it releases every
# deferred run (so removing the cap drains the backlog); with nothing deferred it is a single indexed query.
class ReleaseDeferredPipelineRuns
  extend InstrumentedJob

  @queue = :q03_pipeline_run

  def self.perform
    new.run
  end

  def run
    rows = PipelineRun.dispatch_deferred.joins(:sample)
                      .order(:dispatch_deferred_at, :id)
                      .pluck("samples.user_id", "pipeline_runs.id")
    return 0 if rows.empty?

    cap = PipelineDispatchThrottle.cap
    released = 0
    rows.group_by(&:first).each do |user_id, user_rows|
      headroom = cap ? cap - PipelineDispatchThrottle.active_count(user_id) : user_rows.size
      next if headroom <= 0

      user_rows.first(headroom).each { |(_, pr_id)| released += 1 if release(pr_id) }
    end
    Rails.logger.info("[ReleaseDeferredPipelineRuns] deferred=#{rows.size} released=#{released} cap=#{cap.inspect}")
    released
  end

  private

  def release(pr_id)
    pr = PipelineRun.find_by(id: pr_id)
    pr ? pr.release_deferred_dispatch! : false
  rescue StandardError => e
    LogUtil.log_error("[ReleaseDeferredPipelineRuns] failed to release pipeline run #{pr_id}", exception: e,
                                                                                               pipeline_run_id: pr_id)
    false
  end
end

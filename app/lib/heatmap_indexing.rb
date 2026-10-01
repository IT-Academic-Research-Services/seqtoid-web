# frozen_string_literal: true

# Bookkeeping for heatmap (re)indexing -- the IndexTaxons jobs that call the taxon-indexing lambda to write a
# pipeline run's scored taxon counts into the heatmap OpenSearch domain, per (background, pipeline run).
#
# WHY: every heatmap request and every frontend retry used to enqueue one IndexTaxons job per not-yet-indexed
# run, with nothing checking whether an identical job was already queued or running. env-prod 2026-09-30: one
# 20-sample heatmap view produced 268 lambda runs for 41 unique (run, background) pairs, and with 10 workers
# the duplicates ran in parallel and pinned the OpenSearch domain at 91-98% CPU. See
# ENV-PROD-HEATMAP-JOBS-OVERLAP-ANALYSIS-2026-10-01.md.
#
# enqueue sets a short-lived "pending" marker per pair with SET NX, so a pair is queued at most once until its
# job finishes (or the marker expires). IndexTaxons releases the marker after a successful run.
module HeatmapIndexing
  # Longer than the worst case a pending pair can legitimately sit: queue wait, plus 4 attempts with
  # [30, 120, 600] s backoff, plus the lambda itself. After it expires a view can enqueue the pair again,
  # which is what we want if the job died without releasing it.
  PENDING_TTL_SECONDS = 1900

  def self.pending_key(background_id, pipeline_run_id)
    "heatmap:index_taxons:pending:#{background_id}:#{pipeline_run_id}"
  end

  # Enqueue IndexTaxons for (background, run) unless one is already pending. force: true always enqueues (and
  # refreshes the marker): used when a run's results were just (re)loaded, so any existing index is stale.
  # Returns true when a job was enqueued.
  #
  # If Redis cannot be reached for the marker, enqueue anyway: a duplicate job is harmless now (IndexTaxons
  # skips runs that are already complete), a dropped one leaves the heatmap unindexed.
  def self.enqueue(background_id, pipeline_run_id, force: false)
    return false if background_id.blank? || pipeline_run_id.blank?

    key = pending_key(background_id, pipeline_run_id)
    claimed = begin
      Resque.redis.set(key, Time.now.to_i, nx: !force, ex: PENDING_TTL_SECONDS)
    rescue StandardError => e
      Rails.logger.warn("HeatmapIndexing: pending marker unavailable for #{key} (#{e.class}); enqueueing anyway")
      true
    end
    return false unless claimed

    Resque.enqueue(IndexTaxons, background_id, pipeline_run_id, force)
    true
  end

  def self.release(background_id, pipeline_run_id)
    Resque.redis.del(pending_key(background_id, pipeline_run_id))
  rescue StandardError => e
    Rails.logger.warn("HeatmapIndexing: could not release pending marker (#{e.class}); it expires on its own")
  end

  # The background heatmaps default to: the configured id when it exists in this environment, otherwise the
  # first public background. A freshly built env may not have the configured id (env-staging had no 26, and
  # the 2026-10-01 env-prod rebuild has none of the old ids). (SMP-1789)
  def self.default_background_id
    configured = Rails.configuration.x.constants.default_background
    return configured if configured.present? && Background.where(id: configured).exists?

    Background.where(public_access: 1).order(:id).limit(1).pick(:id)
  end

  # Of the given runs, the ones worth indexing: finished successfully and Illumina (the heatmap is short-read
  # mNGS only). Runs still loading results, failed runs and ONT runs are never indexed, so they can never sit
  # "missing" and be re-enqueued on every view.
  def self.indexable_run_ids(pipeline_run_ids)
    return [] if pipeline_run_ids.blank?

    PipelineRun.where(
      id: pipeline_run_ids,
      results_finalized: PipelineRun::FINALIZED_SUCCESS,
      technology: PipelineRun::TECHNOLOGY_INPUT[:illumina]
    ).pluck(:id)
  end
end

require 'elasticsearch/model'

# Indexes records for elasticsearch record
class IndexTaxons
  extend InstrumentedJob
  # This job invokes the taxon-indexing Lambda + writes to OpenSearch, both of which
  # fail transiently (throttling, 429s, endpoint blips). Retry with backoff and
  # dead-letter on exhaustion so a heatmap-indexing failure is retried + visible
  # rather than silently dropped (#496).
  extend ResqueRetryWithDeadLetter
  # 1 attempt + 3 retries (30 s, 2 min, 10 min). Each attempt makes a single lambda call (max_attempts: 1
  # below) so the retries do not stack with an in-job retry. Fits inside HeatmapIndexing::PENDING_TTL_SECONDS.
  configure_retry_with_dead_letter(backoff: [30, 120, 600])

  @queue = :index_taxons

  # force: re-index even if the run is already complete for this background (its results were just loaded).
  # Jobs enqueued before force existed carry two arguments and default to false.
  def self.perform(background_id, pipeline_run_id, force = false)
    if !force && already_indexed?(background_id, pipeline_run_id)
      Rails.logger.info("Skip taxon indexing for pipeline_run_id: #{pipeline_run_id} background_id: #{background_id} (already complete)")
      HeatmapIndexing.release(background_id, pipeline_run_id)
      return
    end

    Rails.logger.info("Start taxon indexing for pipeline_run_id: #{pipeline_run_id}")
    ElasticsearchQueryHelper.call_taxon_indexing_lambda(background_id, [pipeline_run_id], max_attempts: 1)
    # Released only on success: while a failing pair is retrying, the marker keeps new views from queueing
    # copies of it. If the job dies or dead-letters, the marker expires on its own.
    HeatmapIndexing.release(background_id, pipeline_run_id)
  end

  # A duplicate that reaches a worker after an earlier copy finished costs one ~10 ms lookup, not a re-index.
  def self.already_indexed?(background_id, pipeline_run_id)
    ElasticsearchQueryHelper.find_complete_pipeline_runs(background_id, [pipeline_run_id]).map(&:to_i).include?(pipeline_run_id.to_i)
  end
end

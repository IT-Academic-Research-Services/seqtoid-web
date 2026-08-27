# CZID-520 -- application-side enforcement of the data retention policy
# (see docs/policy/DATA-RETENTION-POLICY.md). This scheduled job finds sample
# runs whose age exceeds the configured retention window and purges their
# outputs + intermediate files by routing through the existing, vetted
# BulkDeletionService (soft delete -> DeletionLog -> HardDeleteObjects -> S3
# cleanup). It does NOT reimplement deletion or touch S3 directly.
#
# SAFETY / FAIL-SAFE DESIGN:
#   - Dry-run by DEFAULT. Deletion only happens when AppConfig
#     ENABLE_DATA_RETENTION_ENFORCEMENT == "1" AND the ENV kill-switch
#     DATA_RETENTION_DRY_RUN is not "1". Otherwise the job only LOGS what it
#     would delete.
#   - Retention-window floor: a configured window below MIN_RETENTION_DAYS is
#     rejected and the job aborts WITHOUT deleting, so a mistakenly small value
#     (e.g. 0 or 1) cannot wipe recent data.
#   - Per-run blast-radius cap: at most MAX_OBJECTS_PER_RUN objects are deleted
#     per invocation; any remainder is left for the next run and logged.
#   - Only records strictly OLDER than the cutoff and not already soft-deleted
#     are ever considered.
#
# The S3 lifecycle rules on the buckets themselves are infrastructure and are
# AWS-gated (authored/held in czid-infra, see the policy doc); this job is the
# in-app enforcement layer and the authoritative deletion path (S3 lifecycle is
# defense-in-depth, not a substitute).
class EnforceDataRetention
  extend InstrumentedJob

  @queue = :enforce_data_retention

  # Default window used when DATA_RETENTION_DAYS is unset (see policy doc).
  DEFAULT_RETENTION_DAYS = 90
  # Fail-safe floor: refuse to run with a window shorter than this.
  MIN_RETENTION_DAYS = 30
  # Blast-radius cap: max objects (sample ids + workflow run ids) deleted per run.
  MAX_OBJECTS_PER_RUN = 1000
  # Batch size for each BulkDeletionService call.
  DELETION_BATCH_SIZE = 100
  SECONDS_OF_DELAY_BETWEEN_BATCHES = 1

  def self.perform
    Rails.logger.info("Starting EnforceDataRetention job.")

    window = retention_days
    unless valid_window?(window)
      LogUtil.log_error(
        "EnforceDataRetention aborted: configured retention window (#{window} days) is below the " \
        "MIN_RETENTION_DAYS floor (#{MIN_RETENTION_DAYS}). Refusing to delete. Fix DATA_RETENTION_DAYS.",
        exception: StandardError.new("retention window below floor")
      )
      return
    end

    cutoff = Time.now.utc - window.days
    dry_run = dry_run?

    candidates = expired_candidates(cutoff)
    total = candidates.values.map(&:size).sum

    LogUtil.log_message(
      "EnforceDataRetention: found #{total} expired object(s) older than #{window} days " \
      "(cutoff #{cutoff.iso8601}). Mode: #{dry_run ? 'DRY-RUN (no deletion)' : 'ENFORCE (deleting)'}."
    )

    return if total.zero?

    if dry_run
      log_dry_run(candidates, cutoff, window)
    else
      enforce(candidates)
    end

    Rails.logger.info("Finished EnforceDataRetention job.")
  rescue StandardError => e
    LogUtil.log_error("Unexpected error encountered during EnforceDataRetention job.", exception: e)
    raise e
  end

  # The configured retention window in days, falling back to the default.
  def self.retention_days
    configured = AppConfigHelper.get_app_config(AppConfig::DATA_RETENTION_DAYS)
    return DEFAULT_RETENTION_DAYS if configured.blank?

    configured.to_i
  end

  def self.valid_window?(window)
    window.is_a?(Integer) && window >= MIN_RETENTION_DAYS
  end

  def self.dry_run?
    enforcement_enabled = AppConfigHelper.get_app_config(AppConfig::ENABLE_DATA_RETENTION_ENFORCEMENT) == "1"
    kill_switch = ENV["DATA_RETENTION_DRY_RUN"] == "1"
    !enforcement_enabled || kill_switch
  end

  # Returns a hash keyed by [user_id, workflow] whose values are the object ids
  # to hand to BulkDeletionService. For mNGS workflows the ids are SAMPLE ids
  # (the service resolves pipeline runs from samples); for CG/AMR/benchmark the
  # ids are WORKFLOW RUN ids. This matches the two BulkDeletionService entry
  # shapes exactly.
  def self.expired_candidates(cutoff)
    groups = Hash.new { |h, k| h[k] = [] }
    tech_to_workflow = WorkflowRun::MNGS_WORKFLOW_TO_TECHNOLOGY.invert

    # mNGS: group sample ids by [user_id, workflow] derived from pipeline run technology.
    PipelineRun.where("pipeline_runs.created_at < ?", cutoff)
               .where(deleted_at: nil)
               .joins(:sample)
               .pluck("samples.user_id", "pipeline_runs.technology", "pipeline_runs.sample_id")
               .each do |user_id, technology, sample_id|
      workflow = tech_to_workflow[technology]
      next if workflow.nil? || user_id.nil?

      groups[[user_id, workflow]] << sample_id
    end

    # CG / AMR / benchmark: group workflow run ids by [user_id, workflow].
    WorkflowRun.where("workflow_runs.created_at < ?", cutoff)
               .where(deleted_at: nil, deprecated: false)
               .joins(:sample)
               .pluck("samples.user_id", "workflow_runs.workflow", "workflow_runs.id")
               .each do |user_id, workflow, run_id|
      next if workflow.nil? || user_id.nil?

      groups[[user_id, workflow]] << run_id
    end

    groups.transform_values(&:uniq)
  end

  def self.log_dry_run(candidates, cutoff, window)
    candidates.each do |(user_id, workflow), ids|
      Rails.logger.info(
        "EnforceDataRetention DRY-RUN: would delete #{ids.size} #{workflow} object(s) for user " \
        "#{user_id} (older than #{window} days / #{cutoff.iso8601}). ids=#{ids.first(50).inspect}" \
        "#{ids.size > 50 ? ' (truncated)' : ''}"
      )
    end
  end

  def self.enforce(candidates)
    deleted = 0

    candidates.each do |(user_id, workflow), ids|
      break if deleted >= MAX_OBJECTS_PER_RUN

      user = User.find_by(id: user_id)
      if user.nil?
        Rails.logger.warn("EnforceDataRetention: skipping user #{user_id} (not found).")
        next
      end

      # Respect the per-run cap: only take what remains of the budget.
      remaining_budget = MAX_OBJECTS_PER_RUN - deleted
      ids_to_process = ids.first(remaining_budget)

      ids_to_process.each_slice(DELETION_BATCH_SIZE) do |batch|
        response = BulkDeletionService.call(object_ids: batch, user: user, workflow: workflow)
        if response[:error].present?
          LogUtil.log_error(
            "EnforceDataRetention: BulkDeletionService reported an error for user #{user_id} " \
            "workflow #{workflow}: #{response[:error]}",
            exception: StandardError.new(response[:error])
          )
        end
        deleted += batch.size
        sleep(SECONDS_OF_DELAY_BETWEEN_BATCHES)
      end
    end

    remaining = candidates.values.map(&:size).sum - deleted
    if remaining.positive?
      LogUtil.log_message(
        "EnforceDataRetention: hit MAX_OBJECTS_PER_RUN cap (#{MAX_OBJECTS_PER_RUN}). " \
        "#{remaining} expired object(s) left for the next scheduled run."
      )
    end
    LogUtil.log_message("EnforceDataRetention: processed #{deleted} expired object(s) for deletion.")
  end
end

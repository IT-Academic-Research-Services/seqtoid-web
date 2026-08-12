# Lock workflow versions older than the per-workflow supported floor -> view-only.
#
# WorkflowVersion.SUPPORTED_VERSION_FLOORS declares the oldest version each workflow can still run on
# the current infra (short-read-mngs 7.0.0 per CZI, 2026-08-12). From here on the model's before_save
# clamps any below-floor row to runnable=false automatically, so newly published/reconciled rows are
# locked at write time. This migration closes the one gap that callback cannot reach: rows ALREADY in
# the catalog (e.g. old short-read lines added by the CZID-974 backfill) that were written before the
# floor existed and are still marked runnable.
#
# Locking = flip runnable to false. That alone yields view-but-don't-run everywhere it matters: the
# selector only offers runnable rows, the dispatch gate and every rerun path re-resolve + refuse a
# non-runnable version, and NOTHING on the results/report/download paths consults this catalog, so
# existing samples that already ran at a locked version stay fully viewable. Idempotent: a no-op once
# the below-floor rows are already non-runnable.
class LockUnsupportedWorkflowVersions < SeedMigration::Migration
  def up
    locked = []
    WorkflowVersion.where(runnable: true).find_each do |wv|
      next unless wv.below_supported_floor?

      # Direct column write: this is a corrective sweep of existing data, and below_supported_floor?
      # has already decided; no need to run the full validation/callback chain per row.
      wv.update_columns(runnable: false) # rubocop:disable Rails/SkipsModelValidations
      locked << "#{wv.workflow} #{wv.version}"
    end

    if locked.any?
      Rails.logger.info("[version-lock] locked below-floor workflow_versions (view-only): #{locked.join(', ')}")
    else
      Rails.logger.info("[version-lock] no runnable below-floor workflow_versions to lock; nothing to do")
    end
  end

  def down
    # Intentionally a no-op. Re-enabling a below-floor version would advertise a run the current infra
    # cannot execute; the model's before_save would clamp it back to non-runnable on the next save
    # anyway. Rolling back the code without this data is safe -- the old code ignores the flag change.
    Rails.logger.info("[version-lock] down is a no-op; locked rows are left non-runnable on purpose")
  end
end

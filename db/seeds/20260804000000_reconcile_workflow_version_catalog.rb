# CZID-982 -- reconcile the workflow-version catalog with the versions actually configured to run.
#
# `workflow_versions` is meant to be the catalog of runnable versions, but nothing has been keeping it
# in step with the `*-version` app_configs that actually select what runs. The drift is real and
# already in production data: as of 2026-08-04, seqtoid-staging's app_config named short-read-mngs
# 8.3.15, long-read-mngs 0.7.12, consensus-genome 3.5.5 and amr 1.4.2 while its `workflow_versions`
# held only the PREVIOUS line (8.3.11 / 0.7.11 / 3.5.1 / 1.2.5). All 137 runs there executed at a
# version with no catalog row at all, and nothing noticed -- because the default dispatch path never
# consulted the catalog.
#
# This migration closes that gap so the fail-closed check added in the same change
# (VersionRetrievalService) cannot break a working environment: it registers a row for every version
# an environment is currently configured to run. It is idempotent and environment-agnostic -- a
# no-op where the rows already exist (dev), and corrective where they do not (staging).
#
# Deliberately a RECONCILIATION, not an auto-create: it runs once, here, over what is already
# configured. The service does NOT create rows on the fly at dispatch time -- silent auto-creation is
# precisely what let this drift go unnoticed. From here on, rows come from the publisher (CZID-971).
class ReconcileWorkflowVersionCatalog < SeedMigration::Migration
  # `<name>-version` app_configs whose value is a workflow version. Mirrors
  # AppConfig::WORKFLOW_VERSION_TEMPLATE.
  APP_CONFIG_VERSION_SUFFIX = "-version".freeze

  def up
    reconciled = []

    AppConfig.where(AppConfig.arel_table[:key].matches("%#{APP_CONFIG_VERSION_SUFFIX}")).each do |config|
      workflow = config.key.sub(/#{Regexp.escape(APP_CONFIG_VERSION_SUFFIX)}\z/, "")
      version = config.value.to_s.strip
      reconciled << ensure_catalogued(workflow, version)
    end

    # The NCBI index default does NOT come from a `*-version` app_config -- VersionRetrievalService
    # resolves it via AlignmentConfig.default_name (the DEFAULT_ALIGNMENT_CONFIG_NAME app_config), so
    # the loop above would miss it. Dev and staging both happen to have this row today, but that is
    # luck rather than an invariant, and the fail-closed check would turn a missing row into broken
    # uploads. Cover it explicitly.
    #
    # The human-host default needs no equivalent: it resolves through
    # WorkflowVersion.latest_version_of, so it is catalog-sourced by construction.
    reconciled << ensure_catalogued(AlignmentConfig::NCBI_INDEX, AlignmentConfig.default_name.to_s.strip)

    reconciled.compact!

    if reconciled.any?
      Rails.logger.info("[CZID-982] reconciled workflow_versions rows for: #{reconciled.join(', ')}")
    else
      Rails.logger.info("[CZID-982] workflow_versions already consistent with app_config; nothing to reconcile")
    end
  end

  # Register `workflow`/`version` if it is not already catalogued. Returns a label when a row was
  # created, nil when nothing was needed -- so the caller can report what changed.
  def ensure_catalogued(workflow, version)
    return nil if workflow.blank? || version.blank?
    return nil if WorkflowVersion.exists?(workflow: workflow, version: version)

    WorkflowVersion.create!(
      workflow: workflow,
      version: version,
      deprecated: false,
      # Runnable by definition: this environment is already configured to run it, and in several
      # cases has been running it for months. Marking it otherwise would break the user path.
      runnable: true
    )
    "#{workflow} #{version}"
  end

  def down
    # Intentionally a no-op. These rows describe versions the environment is configured to run, and
    # after this migration the dispatch path REQUIRES a catalog row (CZID-982). Removing them on
    # rollback would break dispatch rather than restore a prior state. Rolling back the code without
    # rolling back this data is safe -- the old code simply ignores the extra rows.
    Rails.logger.info("[CZID-982] down is a no-op; reconciled catalog rows are left in place on purpose")
  end
end

# CZID-977 -- seed each workflow version's index-compatibility FLOOR from observed run history.
#
# The real compatibility boundaries are a scientific judgment about reference-data format and
# content, and nothing in this codebase records them. Rather than invent numbers that would look
# authoritative, this derives the one bound that IS evidenced: the oldest NCBI index vintage a
# version has actually completed a run against.
#
# Semantics, deliberately asymmetric:
#
#   min_index_version  <- oldest index this version has SUCCESSFULLY run against.
#                         "We have seen this work at least this far back."
#   max_index_version  <- left NULL. Observation cannot establish an upper bound: a version may work
#                         with newer indexes nobody has tried yet, and capping at the newest observed
#                         vintage would reject the current index the moment a new one is published.
#
# Only FINALIZED_SUCCESS runs count. A dispatched-but-failed pairing is not evidence that the pairing
# works -- it is arguably evidence of the opposite.
#
# KNOWN LIMITATION (accepted, Tom 2026-08-05): this is a floor from limited data. A version might run
# correctly against an index older than anything yet attempted, and such a run will now be refused.
# The error names both halves and the recorded range so the operator can either pick a different
# version or widen the bound deliberately. Widening is a data change, not a code change.
#
# Environment-adaptive by construction: each environment computes from its own run history, so dev,
# staging and prod each get floors reflecting what they have actually executed.
class SeedObservedIndexCompatibilityFloors < SeedMigration::Migration
  def up
    floors = observed_floors
    if floors.empty?
      Rails.logger.info("[CZID-977] no successful runs with an alignment config; no floors to seed")
      return
    end

    seeded = []
    floors.each do |(workflow, version), oldest_index|
      entry = WorkflowVersion.find_by(workflow: workflow, version: version)
      next if entry.nil? # uncatalogued version -- CZID-982 governs those, not this
      next if entry.min_index_version.present? # never overwrite a deliberately set bound

      entry.update!(min_index_version: oldest_index)
      seeded << "#{workflow} #{version} >= #{oldest_index}"
    end

    Rails.logger.info(
      seeded.any? ? "[CZID-977] seeded index floors: #{seeded.join(', ')}" : "[CZID-977] nothing to seed"
    )
  end

  def down
    # Only clear what this migration could have set. A bound entered deliberately after the fact is
    # indistinguishable here, so this is intentionally conservative rather than a blanket wipe.
    WorkflowVersion.where.not(min_index_version: nil).find_each do |entry|
      entry.update!(min_index_version: nil)
    end
    Rails.logger.info("[CZID-977] cleared seeded index floors")
  end

  private

  # {[workflow, version] => oldest successfully-used index vintage}
  def observed_floors
    rows = PipelineRun
           .joins(:alignment_config)
           .where(results_finalized: PipelineRun::FINALIZED_SUCCESS)
           .where.not(wdl_version: nil)
           .pluck(:wdl_version, "alignment_configs.name")

    rows.group_by(&:first).transform_values do |group|
      # Oldest by numeric segment, not lexically -- these are ISO dates and the CZID-972 ordering
      # already handles them.
      group.map(&:last).compact.min_by { |name| WorkflowVersion.version_sort_key(name) }
    end.filter_map do |wdl_version, oldest|
      next nil if oldest.blank?

      workflow = workflow_for(wdl_version)
      workflow ? [[workflow, wdl_version], oldest] : nil
    end.to_h
  end

  # A pipeline_run's wdl_version does not record which workflow it belongs to, so resolve it through
  # the catalog. Ambiguity is impossible in practice (the version strings do not collide across
  # workflows) but is skipped rather than guessed if it ever occurs.
  def workflow_for(wdl_version)
    workflows = WorkflowVersion.where(version: wdl_version).distinct.pluck(:workflow)
    workflows.length == 1 ? workflows.first : nil
  end
end

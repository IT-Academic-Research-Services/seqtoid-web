# frozen_string_literal: true

# Pure helpers for the blue/green taxonomy load, extracted so the naming + SQL construction is
# unit-testable without a database. The rake (lib/tasks/taxonomy_load.rake) does the I/O.
#
# Blue/green model (epic #548): the new cumulative versioned-lineages CSV contains the FULL version
# history (it chains previous_lineages), so a load is a whole-table REPLACE, not an append. We load
# the new data into a side table, then swap it into place with an atomic MySQL `RENAME TABLE`, which
# preserves the old table under a backup name -> instant, data-preserving rollback (nothing is ever
# dropped by the load). The ES index gets the same treatment: build a fresh versioned index, then move
# the `taxon_lineages_alias` alias to it, retaining the old index.
module TaxonomyBlueGreen
  module_function

  LIVE_TABLE = "taxon_lineages"
  ALIAS_NAME = "taxon_lineages_alias"

  # A version string like "2026-07-09" -> a safe MySQL/ES identifier fragment "2026_07_09".
  def slug(version)
    version.to_s.strip.gsub(/[^0-9A-Za-z]+/, "_").gsub(/\A_+|_+\z/, "")
  end

  # The side table the new data is loaded into before the swap.
  def staging_table(version)
    "#{LIVE_TABLE}_v#{slug(version)}"
  end

  # The name the current live table is renamed to on swap = the rollback point. Timestamped so
  # repeated loads never collide and history is auditable.
  def backup_table(timestamp)
    "#{LIVE_TABLE}_bak_#{timestamp}"
  end

  # The fresh, concrete ES index the alias will point at (never reuse a name -> a failed rebuild can't
  # corrupt the serving index).
  def index_name(version, timestamp)
    # ES/OpenSearch index names MUST be lowercase, but the timestamp carries uppercase T/Z
    # (e.g. 20260722T1955Z) -> create_index 400s with invalid_index_name_exception and the load's
    # DB swap succeeds but the ES rebuild dies. Downcase so the derived index name is always valid.
    "#{LIVE_TABLE}_v#{slug(version)}_#{timestamp}".downcase
  end

  # Atomic swap: stage table becomes live, live becomes the backup -- one statement, no window where
  # `taxon_lineages` is absent.
  def swap_sql(staging, backup)
    "RENAME TABLE `#{LIVE_TABLE}` TO `#{backup}`, `#{staging}` TO `#{LIVE_TABLE}`"
  end

  # Reverse swap for rollback: current live -> a parked name, the backup -> live. The parked name lets
  # a bad new table be inspected rather than dropped.
  def rollback_sql(backup, parked)
    "RENAME TABLE `#{LIVE_TABLE}` TO `#{parked}`, `#{backup}` TO `#{LIVE_TABLE}`"
  end

  # Guard: only ever operate on names this module minted, so a typo'd arg can't rename an unrelated
  # table. Backups/staging/parked all start with the live table name + a known separator.
  def managed_name?(name)
    n = name.to_s
    n == LIVE_TABLE ||
      n.start_with?("#{LIVE_TABLE}_v") ||
      n.start_with?("#{LIVE_TABLE}_bak_") ||
      n.start_with?("#{LIVE_TABLE}_parked_")
  end

  # --- rollback robustness helpers (#548 hardening) ------------------------------------------------
  # A load renames the current live table to `taxon_lineages_bak_<ts>` and never drops it, so rollback
  # is a pure RENAME back -- the restored table is the SAME physical rows, not a copy. These helpers
  # let an operator (a) find the backup with no bookkeeping, and (b) PROVE the restore is byte-identical.

  BACKUP_PREFIX = "#{LIVE_TABLE}_bak_"

  # Recognize a backup table name and pull its timestamp fragment for ordering.
  def backup_timestamp(name)
    n = name.to_s
    return nil unless n.start_with?(BACKUP_PREFIX)

    n.delete_prefix(BACKUP_PREFIX)
  end

  # Newest preserved backup from a list of table names -- the default rollback target, so an operator
  # can `taxonomy:rollback` with no argument. Timestamps are UTC `%Y%m%dT%H%MZ`, lexically sortable.
  def latest_backup(table_names)
    Array(table_names).select { |n| backup_timestamp(n) }
                      .max_by { |n| backup_timestamp(n) }
  end

  # SHOW TABLES filter that returns exactly the preserved backups (newest-first ordering is applied in
  # Ruby via latest_backup / sort, since SHOW TABLES cannot ORDER BY).
  def show_backups_sql
    "SHOW TABLES LIKE '#{BACKUP_PREFIX}%'"
  end

  # A content fingerprint used to PROVE a rollback restored the exact prior state. CHECKSUM TABLE is a
  # deterministic function of row content (independent of table name), so the pre-load fingerprint of
  # the live table equals the post-rollback fingerprint iff the identical rows are back. Paired with
  # the row count + version range it is a strong, cheap equality proof.
  def checksum_sql(table = LIVE_TABLE)
    "CHECKSUM TABLE `#{table}`"
  end

  def stats_sql(table = LIVE_TABLE)
    "SELECT COUNT(*) AS row_count, COUNT(DISTINCT taxid) AS distinct_taxid, " \
      "MIN(version_start) AS min_version_start, MAX(version_end) AS max_version_end " \
      "FROM `#{table}`"
  end

  # True iff two fingerprint hashes describe identical table content. Compares the CHECKSUM TABLE value
  # AND the row count/version range (belt-and-suspenders: a checksum match with a differing count would
  # signal something pathological, so we require both).
  def fingerprint_match?(a, b)
    return false if a.nil? || b.nil?

    %w[checksum row_count distinct_taxid min_version_start max_version_end].all? do |k|
      a[k].to_s == b[k].to_s && !a[k].nil?
    end
  end
end

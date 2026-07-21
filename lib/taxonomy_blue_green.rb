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
    "#{LIVE_TABLE}_v#{slug(version)}_#{timestamp}"
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
end

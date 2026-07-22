# frozen_string_literal: true

require Rails.root.join("lib/taxonomy_blue_green").to_s

# DB/ES I/O for the taxonomy rollback safety net (#548 hardening). The pure name/SQL construction lives
# in TaxonomyBlueGreen (unit-tested without a DB); this module does the reads/writes the rake tasks need:
#   * compute_fingerprint -- a cheap, deterministic content fingerprint used to PROVE a rollback
#     restored the exact prior state (rollback is a RENAME back, so the restored rows are literally the
#     same physical rows; the fingerprint guards against operator error / picking the wrong backup).
#   * list_backups / latest -- discover preserved backups so an operator can roll back with no bookkeeping.
#   * restore_es_alias -- put the derived ES serving alias back, fast when a retained prior index still
#     matches, correct-by-reindex otherwise.
module TaxonomyRollbackSupport
  module_function

  BG = TaxonomyBlueGreen

  # {checksum, row_count, distinct_taxid, min_version_start, max_version_end} for a table.
  # CHECKSUM TABLE is a deterministic function of row content, independent of the table name, so the
  # value computed on the backup table == the value on the live table after a rollback RENAME.
  def compute_fingerprint(conn, table = BG::LIVE_TABLE)
    checksum = conn.select_all(BG.checksum_sql(table)).first&.fetch("Checksum", nil)
    stats = conn.select_one(BG.stats_sql(table)) || {}
    {
      "table" => table,
      "checksum" => checksum,
      "row_count" => stats["row_count"],
      "distinct_taxid" => stats["distinct_taxid"],
      "min_version_start" => stats["min_version_start"],
      "max_version_end" => stats["max_version_end"],
    }
  end

  # All preserved backup tables, newest-first.
  def list_backups(conn)
    conn.select_rows(BG.show_backups_sql).flatten
        .select { |n| BG.backup_timestamp(n) }
        .sort_by { |n| BG.backup_timestamp(n) }
        .reverse
  end

  def latest_backup(conn)
    list_backups(conn).first
  end

  # Current serving state of the ES alias: which concrete index it points at, and its doc count.
  def es_alias_state
    client = TaxonLineage.__elasticsearch__.client
    return { "alias_target" => nil, "doc_count" => nil } unless client.indices.exists_alias(name: BG::ALIAS_NAME)

    target = client.indices.get_alias(name: BG::ALIAS_NAME).keys.first
    count = client.count(index: BG::ALIAS_NAME)["count"]
    { "alias_target" => target, "doc_count" => count }
  rescue StandardError => e
    { "alias_target" => "(error: #{e.class})", "doc_count" => nil }
  end

  # Restore the ES serving alias after a DB rollback. ES is DERIVED from the table, so correctness is
  # always recoverable by reindex; we take the fast path only when it is provably equivalent.
  #   fast path  -- a retained prior index (taxon_lineages_v*) exists that is NOT the current target and
  #                 whose doc count equals the restored table's row count: just move the alias (seconds).
  #   safe path  -- otherwise reindex from the restored table into a fresh index, then move the alias.
  # Returns a human-readable description of what it did.
  def restore_es_alias(restored_row_count:)
    client = TaxonLineage.__elasticsearch__.client
    current = client.indices.exists_alias(name: BG::ALIAS_NAME) ? client.indices.get_alias(name: BG::ALIAS_NAME).keys.first : nil

    candidates = client.indices.get(index: "#{BG::LIVE_TABLE}_v*").keys
                       .reject { |i| i == current }
                       .sort.reverse
    match = candidates.find do |idx|
      client.indices.refresh(index: idx)
      client.count(index: idx)["count"].to_i == restored_row_count.to_i
    rescue StandardError
      false
    end

    if match
      move_alias(client, to: match, from: current)
      "ES alias #{BG::ALIAS_NAME} -> #{match} (retained index, doc_count matched #{restored_row_count}); fast path"
    else
      fresh = "#{BG::LIVE_TABLE}_rollback_#{Time.now.utc.strftime('%Y%m%dT%H%MZ')}"
      TaxonLineage.__elasticsearch__.create_index!(index: fresh)
      TaxonLineage.__elasticsearch__.import(index: fresh, refresh: true)
      move_alias(client, to: fresh, from: current)
      "ES alias #{BG::ALIAS_NAME} -> #{fresh} (reindexed from restored table); safe path"
    end
  end

  def move_alias(client, to:, from:)
    actions = [{ add: { index: to, alias: BG::ALIAS_NAME } }]
    actions << { remove: { index: from, alias: BG::ALIAS_NAME } } if from && from != to
    client.indices.update_aliases(body: { actions: actions })
  end

  # Pretty one-line fingerprint for logs.
  def fmt(fp)
    return "(nil)" if fp.nil?

    "rows=#{fp['row_count']} distinct_taxid=#{fp['distinct_taxid']} " \
      "versions=[#{fp['min_version_start']}..#{fp['max_version_end']}] checksum=#{fp['checksum']}"
  end
end

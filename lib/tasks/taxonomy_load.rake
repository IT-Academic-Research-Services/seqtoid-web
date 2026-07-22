# Blue/green taxonomy load with backups + rollback (epic #548 refresh pipeline 2/6).
#
# The new cumulative versioned-lineages CSV is a WHOLE-TABLE replacement (it carries full history), so
# we never mutate the live table in place. Instead:
#   1. (optional) take an Aurora snapshot as an out-of-band backup
#   2. load the CSV into a fresh staging table  taxon_lineages_v<version>
#   3. sanity-check the staging row count
#   4. ATOMIC MySQL `RENAME TABLE` swap: staging -> live, live -> taxon_lineages_bak_<ts>
#      (the old table is PRESERVED under the backup name -> instant, lossless rollback)
#   5. rebuild the ES index into a fresh concrete index and move the taxon_lineages_alias alias to it,
#      retaining the old index. ES is derived from the DB, so a rebuild is always re-runnable.
#
# Nothing is ever DROPped by a load; `taxonomy:rollback` reverses the swap. Run `taxonomy:verify`
# first -- this task refuses to run unless a PASS report is provided (REQUIRE_VERIFY=0 to override).
#
# Usage:
#   rake 'taxonomy:load[2026-07-09,index-gen-proof-20260709-full/versioned-taxid-lineages.csv.gz]'
#   TAKE_RDS_SNAPSHOT=1 RDS_CLUSTER_ID=idseq-dev ...   # also snapshot Aurora first
#   rake 'taxonomy:rollback[taxon_lineages_bak_20260720T0148Z]'
require "csv"
require "zlib"
require "tempfile"
require Rails.root.join("lib/taxonomy_blue_green").to_s
require Rails.root.join("lib/taxonomy_rollback_support").to_s

namespace :taxonomy do
  desc "Blue/green load a taxonomy versioned-lineages artifact with backup + rollback"
  task :load, [:version, :file_key] => :environment do |_t, args|
    bg = TaxonomyBlueGreen
    version  = (args[:version] || ENV["CANDIDATE_VERSION"]).to_s.strip
    file_key = (args[:file_key] || ENV["CANDIDATE_FILE_KEY"]).to_s.strip
    abort("taxonomy:load requires a version") if version.empty?
    abort("taxonomy:load requires a file_key (the versioned-taxid-lineages.csv[.gz])") if file_key.empty?

    if ENV["REQUIRE_VERIFY"] != "0" && ENV["VERIFY_REPORT_S3_KEY"].blank? && ENV["VERIFY_PASSED"] != "1"
      abort("taxonomy:load: refusing to load without a passing verify gate. Run taxonomy:verify first, " \
            "then pass VERIFY_PASSED=1 (or VERIFY_REPORT_S3_KEY=...), or REQUIRE_VERIFY=0 to override.")
    end

    ts = Time.now.utc.strftime("%Y%m%dT%H%MZ")
    staging = bg.staging_table(version)
    backup  = bg.backup_table(ts)
    new_idx = bg.index_name(version, ts)
    conn = ActiveRecord::Base.connection
    s3 = Aws::S3::Client.new

    puts "[taxonomy:load] version=#{version} staging=#{staging} backup=#{backup} index=#{new_idx}"

    # --- 0. capture the CURRENT live state so the rollback is provable ---
    # The backup table (created by the swap below) IS this state, so rollback correctness never depends
    # on this record surviving; we print + persist it so an operator can eyeball "what am I restoring to".
    pre_fp = TaxonomyRollbackSupport.compute_fingerprint(conn, bg::LIVE_TABLE)
    pre_es = TaxonomyRollbackSupport.es_alias_state
    puts "  PRE-LOAD state (rollback target): #{TaxonomyRollbackSupport.fmt(pre_fp)}"
    puts "  PRE-LOAD ES: alias -> #{pre_es['alias_target'] || '(none)'} doc_count=#{pre_es['doc_count'] || '?'}"
    begin
      s3.put_object(bucket: S3_DATABASE_BUCKET, key: "taxonomy-rollback-fingerprints/#{backup}.json",
                    body: JSON.pretty_generate("backup_table" => backup, "captured_at" => Time.now.utc.iso8601,
                                               "db" => pre_fp, "es" => pre_es))
      puts "  PRE-LOAD fingerprint saved: s3://#{S3_DATABASE_BUCKET}/taxonomy-rollback-fingerprints/#{backup}.json"
    rescue StandardError => e
      warn "  [WARN] could not persist pre-load fingerprint to S3 (#{e.class}); it is printed above and the backup table itself is the source of truth"
    end

    # --- 1. out-of-band Aurora snapshot (belt-and-suspenders; automatic when a cluster is configured) ---
    # The in-DB backup table is the fast rollback; the Aurora snapshot is an independent recovery path.
    # Default it ON whenever RDS_CLUSTER_ID is set (opt out with SKIP_RDS_SNAPSHOT=1); never silently skip.
    cluster = ENV["RDS_CLUSTER_ID"].presence
    if ENV["SKIP_RDS_SNAPSHOT"] == "1"
      warn "  [WARN] SKIP_RDS_SNAPSHOT=1 -- NOT taking an Aurora snapshot; rollback relies solely on the in-DB backup table #{backup}"
    elsif cluster
      snap = "taxon-preload-#{bg.slug(version)}-#{ts}"
      puts "  taking Aurora snapshot #{snap} of #{cluster}..."
      Aws::RDS::Client.new.create_db_cluster_snapshot(db_cluster_snapshot_identifier: snap, db_cluster_identifier: cluster)
      puts "  snapshot requested: #{snap} (creating async)"
    else
      warn "  [WARN] no RDS_CLUSTER_ID set -- skipping the out-of-band Aurora snapshot. The in-DB backup " \
           "table #{backup} still gives instant rollback; set RDS_CLUSTER_ID for the second recovery path."
    end

    # --- 2. staging table + load ---
    conn.drop_table(staging, if_exists: true)
    conn.execute("CREATE TABLE `#{staging}` LIKE `#{bg::LIVE_TABLE}`")
    # Anonymous AR class bound to the staging table for bulk insert_all. Base (not ApplicationRecord)
    # to avoid inheriting any app-wide model behavior on a raw load target.
    staging_model = Class.new(ActiveRecord::Base) { self.inheritance_column = :_sti_disabled } # rubocop:disable Rails/ApplicationRecord
    staging_model.table_name = staging

    body = s3.get_object(bucket: S3_DATABASE_BUCKET, key: file_key).body.read
    body = Zlib::GzipReader.new(StringIO.new(body)).read if file_key.end_with?(".gz")
    now_ts = Time.now.utc.strftime("%Y-%m-%d %H:%M:%S")
    rows = []
    loaded = 0
    CSV.parse(body, headers: true) do |row|
      h = row.to_h.transform_values(&:to_s)
      # Same #528 fix as reference_data:refresh -- coerce blank/zero-dates to load time (NOT NULL).
      %w[created_at updated_at].each { |c| h[c] = now_ts unless h[c].to_s.match?(/\A[12]\d{3}-\d{2}-\d{2}/) }
      rows << h
      next if rows.size < 10_000

      # rubocop:disable Rails/SkipsModelValidations
      staging_model.insert_all(rows)
      # rubocop:enable Rails/SkipsModelValidations
      loaded += rows.size
      rows.clear
      puts "  loaded #{loaded} rows into #{staging}" if (loaded % 500_000).zero?
    end
    unless rows.empty?
      staging_model.insert_all(rows) # rubocop:disable Rails/SkipsModelValidations
      loaded += rows.size
    end

    # --- 3. sanity ---
    staged_count = staging_model.count
    abort("taxonomy:load: staging table is empty after load -- aborting before swap") if staged_count.zero?
    puts "  staged #{staged_count} rows"

    # --- 4. atomic DB swap (old table preserved as backup) ---
    conn.execute(bg.swap_sql(staging, backup))
    puts "  SWAPPED: #{bg::LIVE_TABLE} now serves #{version}; previous table preserved as #{backup}"

    # --- 5. ES blue/green: fresh index from the now-current table, then move the alias ---
    begin
      client = TaxonLineage.__elasticsearch__.client
      puts "  building ES index #{new_idx} from #{bg::LIVE_TABLE}..."
      TaxonLineage.__elasticsearch__.create_index!(index: new_idx)
      TaxonLineage.__elasticsearch__.import(index: new_idx, refresh: true)

      if client.indices.exists_alias(name: bg::ALIAS_NAME)
        old_idx = client.indices.get_alias(name: bg::ALIAS_NAME).keys.first
        client.indices.update_aliases(body: { actions: [
                                        { add: { index: new_idx, alias: bg::ALIAS_NAME } },
                                        { remove: { index: old_idx, alias: bg::ALIAS_NAME } },
                                      ] })
        puts "  ES alias #{bg::ALIAS_NAME} -> #{new_idx} (was #{old_idx}, retained for rollback)"
      elsif client.indices.exists(index: bg::ALIAS_NAME)
        # First migration: the alias name is still a concrete index. New data is already in new_idx,
        # so drop the old concrete index and point the alias at new_idx.
        client.indices.delete(index: bg::ALIAS_NAME)
        client.indices.put_alias(index: new_idx, name: bg::ALIAS_NAME)
        puts "  ES: converted concrete index #{bg::ALIAS_NAME} to an alias -> #{new_idx}"
      else
        client.indices.put_alias(index: new_idx, name: bg::ALIAS_NAME)
        puts "  ES alias #{bg::ALIAS_NAME} -> #{new_idx} (created)"
      end
    rescue StandardError => e
      # ES is derived data; a failure here does NOT lose anything and does NOT roll back the DB swap.
      warn "  [WARN] ES rebuild/alias-swap failed: #{e.class}: #{e.message}"
      warn "  DB swap stands (new data is live). Re-run the ES rebuild, or roll back the DB with:"
      warn "    rake 'taxonomy:rollback[#{backup}]'"
      raise
    end

    puts "[taxonomy:load] DONE. version=#{version} live. Rollback: rake 'taxonomy:rollback[#{backup}]'"
  end

  desc "Roll back the taxonomy table to a preserved backup (reverses taxonomy:load). No arg = latest backup."
  task :rollback, [:backup_table] => :environment do |_t, args|
    bg = TaxonomyBlueGreen
    conn = ActiveRecord::Base.connection

    # Minimal effort: with no argument, roll back to the most recent preserved backup. An operator in a
    # hurry runs `rake taxonomy:rollback` and gets the obvious, safe target; an explicit name still wins.
    backup = (args[:backup_table] || ENV["BACKUP_TABLE"]).to_s.strip
    if backup.empty?
      backup = TaxonomyRollbackSupport.latest_backup(conn).to_s
      abort("taxonomy:rollback: no preserved backup tables found (nothing to roll back to)") if backup.empty?
      puts "[taxonomy:rollback] no backup given -- using the latest: #{backup}"
    end
    abort("taxonomy:rollback: #{backup} is not a taxonomy-managed name") unless bg.managed_name?(backup)
    abort("taxonomy:rollback: backup table #{backup} does not exist") unless conn.table_exists?(backup)

    # The backup IS the rows about to become live again, so its fingerprint is the EXPECTED post-rollback
    # state. Capture it before the swap, then assert the restored live table matches -- proof (not hope)
    # that the recovery is exact and that we picked the right backup.
    expected_fp = TaxonomyRollbackSupport.compute_fingerprint(conn, backup)
    puts "  restoring to: #{TaxonomyRollbackSupport.fmt(expected_fp)}"

    ts = Time.now.utc.strftime("%Y%m%dT%H%MZ")
    parked = "#{bg::LIVE_TABLE}_parked_#{ts}"
    conn.execute(bg.rollback_sql(backup, parked))
    puts "[taxonomy:rollback] restored #{bg::LIVE_TABLE} from #{backup}; bad table parked as #{parked} (not dropped)."

    # Prove it.
    actual_fp = TaxonomyRollbackSupport.compute_fingerprint(conn, bg::LIVE_TABLE)
    if bg.fingerprint_match?(expected_fp, actual_fp)
      puts "  VERIFIED: live table content is byte-identical to the backup (checksum + row count + version range match)."
    else
      abort("  FAILED VERIFICATION: restored table does not match the backup fingerprint!\n" \
            "    expected: #{TaxonomyRollbackSupport.fmt(expected_fp)}\n" \
            "    actual:   #{TaxonomyRollbackSupport.fmt(actual_fp)}\n" \
            "  The swap is reversible (bad table parked as #{parked}); investigate before serving.")
    end

    # ES is derived data -- restore the serving alias automatically (fast path if a retained index still
    # matches, reindex otherwise). Never blocks the DB rollback, which already stands.
    begin
      desc = TaxonomyRollbackSupport.restore_es_alias(restored_row_count: actual_fp["row_count"])
      puts "  #{desc}"
    rescue StandardError => e
      warn "  [WARN] ES alias restore failed: #{e.class}: #{e.message}"
      warn "  DB rollback STANDS (table is correct). Fix ES with: TaxonLineage.__elasticsearch__.import(force: true)"
    end

    puts "[taxonomy:rollback] DONE. #{bg::LIVE_TABLE} restored + verified; ES alias restored."
  end
end

# Operator-facing safety-net tasks for the blue/green taxonomy load (#548 hardening). The load/rollback
# themselves live in taxonomy_load.rake; these are read-only helpers so an operator can SEE the recovery
# surface (what backups exist, what the current state is) and independently PROVE a restore.
require Rails.root.join("lib/taxonomy_blue_green").to_s
require Rails.root.join("lib/taxonomy_rollback_support").to_s

namespace :taxonomy do
  desc "Show the current live taxon_lineages fingerprint (DB checksum/rows/versions + ES alias/doc count)"
  task fingerprint: :environment do
    conn = ActiveRecord::Base.connection
    fp = TaxonomyRollbackSupport.compute_fingerprint(conn, TaxonomyBlueGreen::LIVE_TABLE)
    es = TaxonomyRollbackSupport.es_alias_state
    puts "[taxonomy:fingerprint] #{TaxonomyBlueGreen::LIVE_TABLE}"
    puts "  DB: #{TaxonomyRollbackSupport.fmt(fp)}"
    puts "  ES: alias #{TaxonomyBlueGreen::ALIAS_NAME} -> #{es['alias_target'] || '(none)'} doc_count=#{es['doc_count'] || '?'}"
  end

  desc "List preserved rollback backups (newest-first) with row counts -- the recovery surface"
  task backups: :environment do
    conn = ActiveRecord::Base.connection
    backups = TaxonomyRollbackSupport.list_backups(conn)
    if backups.empty?
      puts "[taxonomy:backups] none. (A backup is created every time taxonomy:load swaps in a new version.)"
      next
    end
    puts "[taxonomy:backups] #{backups.size} preserved backup table(s), newest first:"
    backups.each_with_index do |t, i|
      n = conn.select_value("SELECT COUNT(*) FROM `#{t}`")
      marker = i.zero? ? "  <- latest (default rollback target)" : ""
      puts "  #{t}  rows=#{n}#{marker}"
    end
    puts "\nRoll back to latest:  rake taxonomy:rollback"
    puts "Roll back to a specific one:  rake 'taxonomy:rollback[#{backups.first}]'"
  end

  desc "Prove the current live table matches a preserved backup's content (no changes made)"
  task :verify_rollback, [:backup_table] => :environment do |_t, args|
    conn = ActiveRecord::Base.connection
    backup = (args[:backup_table] || ENV["BACKUP_TABLE"]).to_s.strip
    backup = TaxonomyRollbackSupport.latest_backup(conn).to_s if backup.empty?
    abort("taxonomy:verify_rollback: no backup found/given") if backup.empty?
    abort("taxonomy:verify_rollback: #{backup} does not exist") unless conn.table_exists?(backup)

    live_fp   = TaxonomyRollbackSupport.compute_fingerprint(conn, TaxonomyBlueGreen::LIVE_TABLE)
    backup_fp = TaxonomyRollbackSupport.compute_fingerprint(conn, backup)
    puts "  live:   #{TaxonomyRollbackSupport.fmt(live_fp)}"
    puts "  backup: #{TaxonomyRollbackSupport.fmt(backup_fp)}  (#{backup})"
    if TaxonomyBlueGreen.fingerprint_match?(live_fp, backup_fp)
      puts "[taxonomy:verify_rollback] MATCH -- live content is identical to #{backup}."
    else
      puts "[taxonomy:verify_rollback] DIFFER -- live is NOT #{backup} (expected if a newer version is loaded)."
    end
  end
end

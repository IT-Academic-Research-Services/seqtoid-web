# Post-load validation harness for a taxonomy refresh (epic #548 refresh pipeline 4/6). Run this on
# dev AFTER taxonomy:load to confirm the new reference is correct-in-place before it is promoted:
#
#   1. orphan anti-join (the #528 detector): every positive tax_id that appears in results
#      (taxon_counts) MUST resolve to a lineage row valid for this version. Orphans = taxa the pipeline
#      can produce but the reference can't name -> blank/■■■ lineages in reports.
#   2. known-panel: the curated load-bearing taxids resolve in the DB to the expected superkingdom.
#   3. ES parity: the taxon_lineages_alias doc count matches the DB's distinct-taxa count (the search
#      index actually rebuilt from the new table).
#
# Emits PASS/FAIL. This is the acceptance gate before promotion; it does NOT run the pipeline sample
# (that is the operational step below) or flip any default.
#
# Usage:
#   rake 'taxonomy:validate[2026-07-09]'            # validate a specific lineage_version
#   rake taxonomy:validate                          # validate the current default config's version
#   MAX_ORPHANS=0  ES_COUNT_TOLERANCE=0.001  REPORT_ONLY=1
require Rails.root.join("lib/taxonomy_verify").to_s

namespace :taxonomy do
  desc "Validate a loaded taxonomy version on dev (orphan anti-join + known-panel + ES parity)"
  task :validate, [:version] => :environment do |_t, args|
    version = (args[:version] || ENV["LINEAGE_VERSION"]).to_s.strip
    if version.empty?
      default_cfg = AlignmentConfig.find_by(name: AlignmentConfig.default_name)
      version = default_cfg&.lineage_version.to_s
    end
    abort("taxonomy:validate: could not determine a lineage_version (pass one or set the default config)") if version.empty?
    max_orphans = (ENV["MAX_ORPHANS"] || "0").to_i
    es_tol = (ENV["ES_COUNT_TOLERANCE"] || "0.001").to_f

    conn = ActiveRecord::Base.connection
    results = []

    puts "[taxonomy:validate] lineage_version=#{version}"

    # 1. orphan anti-join -- positive result taxids with no lineage valid for this version.
    orphan_count = conn.select_value(<<~SQL.squish).to_i
      SELECT COUNT(*) FROM (
        SELECT DISTINCT tc.tax_id
        FROM taxon_counts tc
        WHERE tc.tax_id > 0
          AND NOT EXISTS (
            SELECT 1 FROM taxon_lineages tl
            WHERE tl.taxid = tc.tax_id
              AND #{conn.quote(version)} BETWEEN tl.version_start AND tl.version_end
          )
      ) orphans
    SQL
    results << { name: "orphan_anti_join", status: (orphan_count <= max_orphans ? :pass : :fail),
                 detail: "#{orphan_count} result taxids unresolved for #{version} (max #{max_orphans})" }

    # 2. known-panel resolution in the DB.
    panel = TaxonomyVerify::KNOWN_PANEL
    resolved = TaxonLineage
               .where(taxid: panel.keys)
               .where("? BETWEEN version_start AND version_end", version)
               .pluck(:taxid, :superkingdom_name).to_h
    panel_problems = panel.filter_map do |taxid, expected|
      got = resolved[taxid]
      next "#{taxid}: missing" if got.nil?
      next "#{taxid}: #{got} != #{expected}" if got != expected

      nil
    end
    results << { name: "known_panel", status: (panel_problems.empty? ? :pass : :fail),
                 detail: panel_problems.empty? ? "all #{panel.size} curated taxa resolve" : panel_problems.join("; ") }

    # 3. ES parity -- alias doc count vs DB distinct taxa.
    db_distinct = TaxonLineage.where("? BETWEEN version_start AND version_end", version).distinct.count(:taxid)
    es_count = begin
      TaxonLineage.__elasticsearch__.client.count(index: "taxon_lineages_alias")["count"].to_i
    rescue StandardError => e
      warn "  [WARN] ES count failed: #{e.message}"
      -1
    end
    es_ok = es_count >= 0 && db_distinct.positive? &&
            ((es_count - db_distinct).abs.to_f / db_distinct) <= es_tol
    results << { name: "es_parity", status: (es_ok ? :pass : :fail),
                 detail: "es=#{es_count} db_distinct=#{db_distinct} (tolerance #{es_tol})" }

    failed = results.select { |r| r[:status] == :fail }
    puts "\n=== taxonomy:validate report ==="
    results.each { |r| puts format("  [%-4s] %-18s %s", r[:status] == :pass ? "PASS" : "FAIL", r[:name], r[:detail]) }
    puts "  ---------------------------------------------"
    overall = failed.empty? ? "PASS" : "FAIL"
    puts "  OVERALL: #{overall}"
    puts "\n  Operational acceptance (do manually before promotion): run a real sample on dev pinned to"
    puts "  the '#{version}' AlignmentConfig and confirm its report/taxonomy/heatmap render."

    abort("[taxonomy:validate] FAIL: #{failed.map { |r| r[:name] }.join(', ')}") if overall == "FAIL" && ENV["REPORT_ONLY"] != "1"
  end
end

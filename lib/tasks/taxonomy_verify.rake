# Verify a candidate taxonomy/lineage artifact BEFORE it is loaded (epic #548 reliability gate).
#
# Runs cheap, artifact-level checks against a candidate index-generation output in S3 -- structural
# (header/schema + required files), statistical sanity (distinct-taxa movement + deletion bounds vs the
# currently-loaded baseline), and a known-taxid panel (load-bearing organisms resolve to the right
# domain) -- and emits a machine-readable PASS/FAIL report. A candidate that fails a BLOCKING check
# must not be loaded. The biological gate (benchmark AUPR against the candidate index) is a separate,
# heavier step wired downstream; this task is the fast pre-filter that runs on every refresh.
#
# The pure decision logic lives in lib/taxonomy_verify.rb (unit-tested); this rake only does I/O.
#
# Usage:
#   rake 'taxonomy:verify[2026-07-09,index-gen-proof-20260709-full]'
# or via ENV (CI):
#   CANDIDATE_VERSION=2026-07-09 CANDIDATE_PREFIX=index-gen-proof-20260709-full rake taxonomy:verify
# Options (ENV):
#   BASELINE_DISTINCT=<n>  skip the DB query, use this baseline distinct-taxa count
#   REPORT_ONLY=1          print the report but always exit 0 (advisory run)
#   REPORT_S3_KEY=<key>    also write the JSON report to s3://$S3_DATABASE_BUCKET/<key>
#   MAX_SHRINK_FRAC / MAX_GROWTH_FRAC / MAX_DELETE_FRAC  override the sanity thresholds
require "json"
require "csv"
require "zlib"
require "tempfile"
require Rails.root.join("lib/taxonomy_verify").to_s

namespace :taxonomy do
  desc "Verify a candidate taxonomy/lineage artifact (structural + sanity + known-panel); PASS/FAIL"
  task :verify, [:version, :prefix] => :environment do |_t, args|
    version = (args[:version] || ENV["CANDIDATE_VERSION"]).to_s.strip
    prefix  = (args[:prefix]  || ENV["CANDIDATE_PREFIX"]).to_s.strip.chomp("/")
    abort("taxonomy:verify requires a version (arg or CANDIDATE_VERSION)") if version.empty?
    abort("taxonomy:verify requires an S3 prefix (arg or CANDIDATE_PREFIX)") if prefix.empty?

    s3 = Aws::S3::Client.new
    bucket = S3_DATABASE_BUCKET
    files = {
      "versioned-taxid-lineages" => "#{prefix}/versioned-taxid-lineages.csv.gz",
      "changed_lineage_taxa" => "#{prefix}/changed_lineage_taxa.csv.gz",
      "new_taxa" => "#{prefix}/new_taxa.csv.gz",
      "deleted_taxa" => "#{prefix}/deleted_taxa.csv.gz",
    }

    puts "[taxonomy:verify] candidate version=#{version} prefix=s3://#{bucket}/#{prefix}"

    # --- object sizes (structural.artifacts) ---
    sizes = {}
    files.each do |base, key|
      sizes[base] = s3.head_object(bucket: bucket, key: key).content_length
    rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchKey
      sizes[base] = nil
    end

    # Download each gzipped artifact ONCE to a Tempfile (memoized -- the 151 MB versioned file is read
    # for both the header and the known-panel pass), then yield a line-streaming reader so nothing is
    # held fully in memory. Tempfiles are unlinked at the end of the task.
    downloads = {}
    stream_gz = lambda do |base, &blk|
      tmp = (downloads[base] ||= begin
        t = Tempfile.new([base, ".csv.gz"]); t.binmode
        s3.get_object(bucket: bucket, key: files[base], response_target: t.path)
        t
      end)
      Zlib::GzipReader.open(tmp.path) { |gz| blk.call(gz) }
    end

    # --- header (structural.header) ---
    header = []
    if sizes["versioned-taxid-lineages"]
      stream_gz.call("versioned-taxid-lineages") { |gz| header = (gz.gets || "").strip.split(",") }
    end

    # --- changelog counts (sanity.deltas), streamed ---
    count_rows = lambda do |base|
      next 0 unless sizes[base]

      n = 0
      stream_gz.call(base) { |gz| gz.each_line.with_index { |_, i| n = i } } # i is 0-based; header at 0 => data = i
      n # last index == data-row count (header consumed as index 0)
    end
    new_count     = count_rows.call("new_taxa")
    changed_count = count_rows.call("changed_lineage_taxa")
    deleted_count = count_rows.call("deleted_taxa")

    # --- baseline (current loaded distinct taxa) ---
    baseline = if ENV["BASELINE_DISTINCT"].present?
                 ENV["BASELINE_DISTINCT"].to_i
               else
                 TaxonLineage.distinct.count(:taxid)
               end

    # --- known-panel resolution: one streaming pass over the versioned file ---
    panel_taxids = TaxonomyVerify::KNOWN_PANEL.keys.to_set
    best = {} # taxid => [version_end, superkingdom_name]  (keep the current/highest version_end)
    if sizes["versioned-taxid-lineages"]
      stream_gz.call("versioned-taxid-lineages") do |gz|
        idx = nil
        CSV.new(gz).each do |row|
          if idx.nil?
            idx = { taxid: row.index("taxid"), sk: row.index("superkingdom_name"), vend: row.index("version_end") }
            next
          end
          tid = row[idx[:taxid]].to_i
          next unless panel_taxids.include?(tid)

          vend = row[idx[:vend]].to_s
          if best[tid].nil? || vend > best[tid][0]
            best[tid] = [vend, row[idx[:sk]].to_s]
          end
        end
      end
    end
    resolved = best.transform_values { |(_v, sk)| sk }

    thresholds = {}
    thresholds[:max_shrink_frac] = ENV["MAX_SHRINK_FRAC"].to_f if ENV["MAX_SHRINK_FRAC"].present?
    thresholds[:max_growth_frac] = ENV["MAX_GROWTH_FRAC"].to_f if ENV["MAX_GROWTH_FRAC"].present?
    thresholds[:max_delete_frac] = ENV["MAX_DELETE_FRAC"].to_f if ENV["MAX_DELETE_FRAC"].present?

    results = [
      TaxonomyVerify.check_artifacts(sizes),
      TaxonomyVerify.check_header(header),
      TaxonomyVerify.check_deltas(baseline_distinct: baseline, new_count: new_count,
                                  changed_count: changed_count, deleted_count: deleted_count,
                                  thresholds: thresholds),
      TaxonomyVerify.check_known_panel(resolved),
    ]
    report = TaxonomyVerify.build_report(results, version: version, prefix: prefix)

    puts "\n=== taxonomy:verify report ==="
    results.each do |r|
      mark = if r.pass?
               "PASS"
             else
               (r.blocking ? "FAIL" : "WARN")
             end
      puts format("  [%-4s] %-22s %s", mark, r.name, r.detail)
    end
    puts "  ---------------------------------------------"
    puts "  OVERALL: #{report[:overall]}"
    puts JSON.pretty_generate(report)

    if ENV["REPORT_S3_KEY"].present?
      s3.put_object(bucket: bucket, key: ENV["REPORT_S3_KEY"], body: JSON.pretty_generate(report),
                    content_type: "application/json")
      puts "  report written to s3://#{bucket}/#{ENV['REPORT_S3_KEY']}"
    end

    if report[:overall] == "FAIL" && ENV["REPORT_ONLY"] != "1"
      abort("[taxonomy:verify] FAIL -- candidate is not eligible to load (blocking: #{report[:blocking_failures].join(', ')})")
    end
  end
end

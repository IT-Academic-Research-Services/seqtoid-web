# frozen_string_literal: true

require "benchmark"
require "json"

# Peak resident set size (MB) of this process, read from /proc/self/status (Linux
# container/pod). Returns nil on platforms without /proc (e.g. local macOS host).
def peak_rss_mb
  status = "/proc/self/status"
  return nil unless File.exist?(status)

  line = File.foreach(status).find { |l| l.start_with?("VmHWM:") }
  line ? (line.split[1].to_f / 1024).round(1) : nil # VmHWM is in kB
end

def bundle_size_mb(dir)
  bytes = Dir.glob(File.join(dir, "*")).sum { |f| File.file?(f) ? File.size(f) : 0 }
  (bytes.to_f / (1024 * 1024)).round(2)
end

# Returns the S3 head_object response for key, or nil if it does not exist.
def s3_head_or_nil(bucket, key)
  AwsClient[:s3].head_object(bucket: bucket, key: key)
rescue Aws::S3::Errors::NotFound
  nil
end

# Yields each list_objects_v2 page for bucket/prefix, following pagination.
def each_s3_page(bucket:, prefix:, delimiter: nil)
  continuation_token = nil
  loop do
    resp = AwsClient[:s3].list_objects_v2(bucket: bucket, prefix: prefix, delimiter: delimiter, continuation_token: continuation_token)
    yield resp
    break unless resp.is_truncated

    continuation_token = resp.next_continuation_token
  end
end

# Resolves an s3:// path to the bundle folder to import. If the path already contains a
# manifest.json it is used as-is; otherwise it is treated as a parent (e.g.
# .../user_data_exports/<id>) and the newest immediate subfolder that has a manifest.json
# is selected -- so callers never need to know the migration timestamp.
def resolve_bundle_prefix(s3_uri)
  bucket, prefix = S3Util.parse_s3_path(s3_uri)
  raise "Invalid S3 URI (expected s3://bucket/prefix): #{s3_uri}" if bucket.blank? || prefix.blank?

  prefix = prefix.chomp("/")
  return "s3://#{bucket}/#{prefix}" if s3_head_or_nil(bucket, "#{prefix}/manifest.json")

  newest = nil
  each_s3_page(bucket: bucket, prefix: "#{prefix}/", delimiter: "/") do |resp|
    resp.common_prefixes.each do |cp|
      sub = cp.prefix.chomp("/")
      manifest = s3_head_or_nil(bucket, "#{sub}/manifest.json")
      newest = [sub, manifest.last_modified] if manifest && (newest.nil? || manifest.last_modified > newest[1])
    end
  end
  raise "No export bundle (a folder with manifest.json) found under s3://#{bucket}/#{prefix}" if newest.nil?

  "s3://#{bucket}/#{newest[0]}"
end

# Downloads a flat export bundle (user.json, manifest.json, <table>.ndjson.gz) from
# an s3://bucket/prefix location into dest_dir. Returns the number of files pulled.
def download_s3_bundle(s3_uri, dest_dir)
  bucket, prefix = S3Util.parse_s3_path(s3_uri)
  raise "Invalid S3 URI (expected s3://bucket/prefix): #{s3_uri}" if bucket.blank? || prefix.blank?

  prefix = "#{prefix}/" unless prefix.end_with?("/")
  count = 0
  each_s3_page(bucket: bucket, prefix: prefix) do |resp|
    resp.contents.each do |obj|
      basename = File.basename(obj.key)
      next if basename.empty? || obj.key.end_with?("/")

      AwsClient[:s3].get_object(bucket: bucket, key: obj.key, response_target: File.join(dest_dir, basename))
      count += 1
    end
  end
  count
end

desc "Import user data from a streaming NDJSON export bundle. " \
     "Usage: rake import_user_data[<dir-or-s3-uri>,<mode>,<target>]. " \
     "<dir-or-s3-uri> is a local bundle dir, an s3:// bundle folder, or an s3:// parent " \
     "(e.g. .../user_data_exports/<id>) whose newest bundle is auto-selected. " \
     "<mode> is one of: dry_run, skip_existing, or live (default). " \
     "<target> is the id of an existing user to import into (default), or 'new' to create a new user from the export."
task :import_user_data, [:input_dir, :mode, :target, :source_bucket, :dest_bucket] => :environment do |_t, args|
  input_dir = args[:input_dir]
  dry_run = args[:mode] == "dry_run"
  skip_existing = args[:mode] == "skip_existing"

  target = args[:target].to_s.strip
  create_user = target.casecmp("new").zero?
  target_user_id = create_user ? nil : target.presence&.to_i

  # Optional S3 bucket rewrite: stored s3://<source_bucket>/... URIs are rewritten
  # to s3://<dest_bucket>/... on insert (for migrating to a differently-named
  # partner bucket). Both must be given to take effect.
  source_bucket = args[:source_bucket].presence
  dest_bucket = args[:dest_bucket].presence

  if input_dir.blank?
    puts "Error: Please provide the path to the export bundle (a local directory or an s3://bucket/prefix)"
    puts "Usage: rake import_user_data[<dir-or-s3-uri>,<mode>,<target>]"
    puts "       <target> = existing user id (e.g. 42), or 'new' to create a user"
    exit 1
  end

  # Import straight from S3: if the bundle path is an s3:// URI, download it to a
  # temp dir and import from there (removed on process exit).
  if input_dir.to_s.start_with?("s3://")
    require "tmpdir"
    require "fileutils"
    bundle_uri = resolve_bundle_prefix(input_dir)
    puts "Resolved newest bundle: #{bundle_uri}" if bundle_uri != input_dir.chomp("/")
    input_dir = Dir.mktmpdir("user_data_import")
    at_exit { FileUtils.remove_entry(input_dir) if Dir.exist?(input_dir) }
    puts "Downloading bundle from #{bundle_uri} ..."
    downloaded = download_s3_bundle(bundle_uri, input_dir)
    if downloaded.zero?
      puts "Error: no bundle files found at #{bundle_uri}"
      exit 1
    end
    puts "Downloaded #{downloaded} file(s) to a temporary directory."
    puts ""
  end

  unless Dir.exist?(input_dir)
    puts "Error: Directory not found: #{input_dir}"
    exit 1
  end

  unless create_user || target_user_id
    puts "Error: Specify a target user id to import into an existing user, or 'new' to create one."
    puts "Usage: rake import_user_data[/path/to/export_dir,live,42]"
    puts "       rake import_user_data[/path/to/export_dir,live,new]"
    exit 1
  end

  puts "=" * 60
  puts "USER DATA IMPORT"
  puts "=" * 60
  puts ""
  mode_label = if dry_run
                 "DRY RUN (no changes will be saved)"
               elsif skip_existing
                 "SKIP EXISTING (re-runnable; skips records whose id already exists)"
               else
                 "LIVE"
               end
  puts "Bundle: #{input_dir}"
  puts "Mode: #{mode_label}"
  puts "Target: #{create_user ? '(create new user from export)' : "existing user ##{target_user_id}"}"
  if source_bucket && dest_bucket
    puts "S3 rewrite: s3://#{source_bucket}/... -> s3://#{dest_bucket}/..."
  end
  puts ""

  # Show manifest
  manifest_path = File.join(input_dir, "manifest.json")
  unless File.exist?(manifest_path)
    puts "Error: manifest.json not found in #{input_dir}"
    exit 1
  end
  manifest = JSON.parse(File.read(manifest_path), symbolize_names: true)
  puts "Export metadata:"
  puts "  Extracted at:       #{manifest[:extracted_at]}"
  puts "  Source environment: #{manifest[:source_environment]}"
  puts "  Original user ID:   #{manifest[:user_id]}"
  puts "  Schema version:     #{manifest[:schema_version]}"
  puts ""
  puts "Data to import (rows by table):"
  (manifest[:table_counts] || {}).sort_by { |_table, count| -count }.each do |table, count|
    puts "  #{table}: #{count}" if count > 0
  end
  puts ""

  unless dry_run
    puts "WARNING: This will create new records in the database."
    puts "Press Enter to continue or Ctrl+C to cancel..."
    $stdin.gets
  end

  puts "Starting import..."
  puts ""

  result = nil
  import_seconds = Benchmark.realtime do
    result = UserDataImportService.call(
      input_dir: input_dir,
      dry_run: dry_run,
      skip_existing: skip_existing,
      target_user_id: target_user_id,
      create_user: create_user,
      source_bucket: source_bucket,
      dest_bucket: dest_bucket
    )
  end

  puts ""
  puts "=" * 60
  puts "IMPORT #{result[:success] ? 'COMPLETED' : 'FAILED'}"
  puts "=" * 60
  puts ""

  if result[:success]
    puts "Mode: #{result[:dry_run] ? 'DRY RUN' : 'LIVE'}"
    puts ""
    puts "Records created:"
    result[:stats].each do |entity, count|
      puts "  #{entity}: #{count}" if count > 0
    end
    puts ""

    if result[:user_id]
      puts "User ID: #{result[:old_user_id]} (old) -> #{result[:user_id]} (new)"
      puts ""
    end

    if result[:warnings].any?
      puts "Warnings (#{result[:warnings].count}):"
      result[:warnings].first(10).each { |warning| puts "  - #{warning}" }
      puts "  ... and #{result[:warnings].count - 10} more" if result[:warnings].count > 10
      puts ""
    end
  else
    puts "Error: #{result[:error]}"
    puts "Error class: #{result[:error_class]}"
    puts ""

    if result[:warnings].any?
      puts "Warnings before failure:"
      result[:warnings].each { |w| puts "  - #{w}" }
    end
  end

  # Performance instrumentation (used to size large-user migrations).
  rss = peak_rss_mb
  puts ""
  puts "Performance:"
  puts "  Bundle size (gzipped): #{bundle_size_mb(input_dir)} MB"
  puts "  Import (stream + insert): #{import_seconds.round(2)}s"
  puts "  Peak RSS:              #{rss ? "#{rss} MB" : 'n/a (no /proc)'}"

  # Per-table insert time: pinpoints the tables that dominate a large import
  # (taxon_counts / contigs) and whether they warrant further batching tuning.
  timings = result[:timings] || {}
  if timings.any?
    puts ""
    puts "  Insert time by table (top 10):"
    timings.sort_by { |_table, seconds| -seconds }.first(10).each do |table, seconds|
      puts "    #{table}: #{seconds.round(2)}s (#{result[:stats][table]} rows)"
    end
  end
end

namespace :import_user_data do
  desc "Verify an import: S3-resolvability spot-check (always) + optional row-count round-trip. " \
       "Usage: rake import_user_data:verify[new_user_id,/path/to/original_export_dir]"
  task :verify, [:new_user_id, :original_dir] => :environment do |_t, args|
    new_user_id = args[:new_user_id]&.to_i
    original_dir = args[:original_dir]

    if new_user_id.blank?
      puts "Usage: rake import_user_data:verify[new_user_id,/path/to/original_export_dir]"
      exit 1
    end

    puts "=" * 60
    puts "IMPORT VERIFICATION"
    puts "=" * 60
    puts ""

    # 1. S3 resolvability: do the imported rows' S3 objects actually exist in the
    #    destination bucket? The DB import and the S3 file copy run independently,
    #    so a gap leaves rows pointing at objects that were never transferred.
    puts "S3 resolvability spot-check (imported run outputs in the destination bucket)..."
    s3 = ImportS3ResolvabilityService.call(new_user_id)
    puts "  Checked #{s3.checked.size} run output prefix(es); #{s3.missing.size} missing."
    s3.missing.first(10).each { |path| puts "  MISSING: #{path}" }
    puts "  ... and #{s3.missing.size - 10} more" if s3.missing.size > 10
    puts ""

    # 2. Row-count round-trip: re-export the imported user (IDs are preserved, so it
    #    re-exports the same graph) and compare table counts against the original
    #    bundle. Needs the export service + the original bundle, so it is skipped in
    #    an import-only deployment.
    counts_match = true
    if original_dir.present? && defined?(UserDataExportService)
      original_manifest = JSON.parse(File.read(File.join(original_dir, "manifest.json")), symbolize_names: true)
      # Normalize keys to strings: the manifest is parsed with symbol keys, while
      # the export service reports table_counts with string keys.
      original_counts = (original_manifest[:table_counts] || {}).transform_keys(&:to_s)

      require "tmpdir"
      Dir.mktmpdir("user_data_verify") do |dir|
        puts "Re-exporting data for user ID: #{new_user_id}..."
        new_result = UserDataExportService.call(user_id: new_user_id, output_dir: dir)
        new_counts = (new_result[:table_counts] || {}).transform_keys(&:to_s)

        puts ""
        puts format("%-30s %10s %10s %s", "Table", "Original", "New", "Status")
        puts "-" * 62
        all_tables = (original_counts.keys + new_counts.keys).uniq.sort
        all_tables.each do |table|
          orig = original_counts[table].to_i
          new_count = new_counts[table].to_i
          match = orig == new_count
          counts_match = false unless match
          puts format("%-30s %10d %10d %s", table, orig, new_count, match ? "OK" : "MISMATCH")
        end
      end
    else
      puts "Skipping row-count round-trip (needs UserDataExportService + original_dir)."
    end

    puts ""
    puts "=" * 60
    if s3.ok? && counts_match
      puts "VERIFICATION PASSED"
    else
      puts "VERIFICATION FAILED"
      puts "  - S3 resolvability: #{s3.missing.size} missing prefix(es)" unless s3.ok?
      puts "  - Row counts: mismatches found (see above)" unless counts_match
      exit 1
    end
  end
end

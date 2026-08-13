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

desc "Import user data from a streaming NDJSON export bundle. " \
     "Usage: rake import_user_data[/path/to/export_dir,<mode>,<target>]. " \
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
    puts "Error: Please provide the path to the export bundle directory"
    puts "Usage: rake import_user_data[/path/to/export_dir,<mode>,<target>]"
    puts "       <target> = existing user id (e.g. 42), or 'new' to create a user"
    exit 1
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
  desc "Verify import by comparing table row counts. Usage: rake import_user_data:verify[new_user_id,/path/to/original_export_dir]"
  task :verify, [:new_user_id, :original_dir] => :environment do |_t, args|
    new_user_id = args[:new_user_id]&.to_i
    original_dir = args[:original_dir]

    if new_user_id.blank? || original_dir.blank?
      puts "Usage: rake import_user_data:verify[new_user_id,/path/to/original_export_dir]"
      exit 1
    end

    # Round-trip verification re-exports the imported user and compares table
    # counts, which requires UserDataExportService (shipped in the export PR).
    # In an import-only deployment it is absent, so skip gracefully.
    unless defined?(UserDataExportService)
      puts "Skipping round-trip verification: UserDataExportService is not available in this"
      puts "import-only deployment (it ships with the export PR). Verify by comparing the imported"
      puts "user's table row counts against the manifest in #{original_dir}/manifest.json."
      exit 0
    end

    puts "=" * 60
    puts "IMPORT VERIFICATION"
    puts "=" * 60
    puts ""

    original_manifest = JSON.parse(File.read(File.join(original_dir, "manifest.json")), symbolize_names: true)
    # Normalize keys to strings: the manifest is parsed with symbol keys, while the
    # export service reports table_counts with string keys.
    original_counts = (original_manifest[:table_counts] || {}).transform_keys(&:to_s)

    # Re-export the imported user to a temp bundle and compare table counts.
    # IDs are preserved, so this re-exports the same graph.
    require "tmpdir"
    Dir.mktmpdir("user_data_verify") do |dir|
      puts "Re-exporting data for user ID: #{new_user_id}..."
      new_result = UserDataExportService.call(user_id: new_user_id, output_dir: dir)
      new_counts = (new_result[:table_counts] || {}).transform_keys(&:to_s)

      puts ""
      puts format("%-30s %10s %10s %s", "Table", "Original", "New", "Status")
      puts "-" * 62

      all_tables = (original_counts.keys + new_counts.keys).uniq.sort
      all_match = true
      all_tables.each do |table|
        orig = original_counts[table].to_i
        new_count = new_counts[table].to_i
        status = orig == new_count ? "OK" : "MISMATCH"
        all_match = false if orig != new_count
        puts format("%-30s %10d %10d %s", table, orig, new_count, status)
      end

      puts ""
      if all_match
        puts "All counts match!"
      else
        puts "WARNING: Some counts do not match. Review the differences above."
      end
    end
  end
end

# frozen_string_literal: true

require "csv"
require "fileutils"
require "tmpdir"

# Works through a queue of CZI user-data export bundles, importing each with UserDataImportService.
# Built for the next-prod backfill (CZI-BACKFILL-NEXT-PROD-DESIGN-AND-RUNBOOK-2026-10-21.md, item W3): run N
# copies at once (a Kubernetes Indexed Job), each against the replica cluster.
#
# Layout under the queue prefix (s3://bucket/prefix/):
#   queue.csv                 export_id,target_user_id[,priority] -- higher priority first, then file order
#   results/<export_id>.json  written after every live attempt (status, mode, timings, stats, warnings, error)
#   dry-runs/<export_id>.json written by a dry-run pass (IMPORT_QUEUE_MODE=dry_run); never counts as done for a live
#                             pass. A dry-run pass skips an export whose dry-run result is a success newer than its
#                             bundle (delete the file to check it again).
#   report.csv                written by `rake import_queue:report`: one row per export, live + dry-run status
#   PAUSE                     while present, workers finish their current export and pick up no new one
#                             (e.g. while a deploy migration on a table the imports write replicates)
#   WORKERS                   optional desired worker count (an integer). A worker whose index is at or above
#                             it finishes its current export and stops, so the pool shrinks without killing
#                             an import mid-way (seqtoid-data-ops autoscale.sh writes it). Absent = no limit.
#
# Per export:
#   1. skip it if results/<id>.json already says success;
#   2. read its manifest (small) and CLAIM it with the importer's per-export named lock -- so two workers
#      never download or import the same bundle (the lock is re-entrant for the importer's own call);
#   3. download the newest bundle under <export_root><id>/ into a scratch dir, files in parallel;
#   4. import (mode live); if the target already holds some of its rows (an earlier partial run), retry once
#      with skip_existing, which resumes;
#   5. write the result and delete the scratch copy.
# A failed export is recorded and the worker moves on; re-running the Job retries only what has not succeeded.
#
# Dry-run mode (IMPORT_QUEUE_MODE=dry_run): the same pass, but each export runs the importer's read-only dry
# run (validates the bundle, reference rows, name renames and primary-key collisions; writes nothing) and the
# result lands in dry-runs/ for review before the live pass. A partially imported export gets a second dry
# run with skip_existing, so the warnings for what is still to come are reported too. An export already
# checked successfully against its current bundle is skipped, so N workers make one pass between them instead
# of each re-checking the whole queue (2026-10-23: 8 workers each walked all 271 exports, ~12 h instead of ~2 h).
class UserDataImportQueue
  class ConfigError < StandardError; end

  RESULTS_PREFIX = "results/"
  PAUSE_KEY = "PAUSE"
  WORKERS_KEY = "WORKERS"
  QUEUE_KEY = "queue.csv"
  DOWNLOAD_THREADS = 4
  PRIMARY_KEYS_EXIST = "Primary keys already exist"
  MODES = %w[live dry_run].freeze
  DRY_RUN_PREFIX = "dry-runs/"
  REPORT_KEY = "report.csv"
  REPORT_COLUMNS = %w[export_id target_user_id priority live_status live_error dry_run_status dry_run_attempts
                      warnings name_conflicts renamed id_conflicts dry_run_error].freeze

  def initialize(queue_uri:, export_root:, source_bucket: nil, dest_bucket: nil, worker: "w0", worker_index: 0,
                 worker_count: 1, s3: AwsClient[:s3], importer: nil, scratch_dir: ENV.fetch("IMPORT_SCRATCH_DIR", Dir.tmpdir),
                 mode: ENV.fetch("IMPORT_QUEUE_MODE", "live"), require_target: true)
    raise ConfigError, "#{UserDataImportService::REQUIRE_DB_HOST_ENV} must be set (the queue only runs against an explicit target database)" if require_target && ENV[UserDataImportService::REQUIRE_DB_HOST_ENV].to_s.strip.empty?
    raise ConfigError, "IMPORT_QUEUE_MODE must be one of #{MODES.join(', ')} (got #{mode.inspect})" unless MODES.include?(mode)

    @mode = mode

    @queue_bucket, @queue_prefix = split_uri(queue_uri)
    @export_bucket, @export_prefix = split_uri(export_root)
    @source_bucket = source_bucket.presence
    @dest_bucket = dest_bucket.presence
    @worker = worker
    @worker_index = worker_index
    @worker_count = [worker_count, 1].max
    @s3 = s3
    @importer = importer || method(:default_import)
    @scratch_dir = scratch_dir
  end

  # Reads every export's live and dry-run results and writes report.csv to the queue prefix (no database).
  def self.report(queue_uri:, s3: AwsClient[:s3])
    new(queue_uri: queue_uri, export_root: queue_uri, s3: s3, require_target: false).write_report
  end

  def write_report
    rows = read_queue.map { |entry| report_row(entry) }
    csv = CSV.generate do |out|
      out << REPORT_COLUMNS
      rows.each { |row| out << REPORT_COLUMNS.map { |c| row[c.to_sym] } }
    end
    @s3.put_object(bucket: @queue_bucket, key: "#{@queue_prefix}#{REPORT_KEY}", body: csv, content_type: "text/csv")
    { exports: rows.size, report: "s3://#{@queue_bucket}/#{@queue_prefix}#{REPORT_KEY}" }
  end

  # One pass over the queue. Returns a summary hash.
  def run
    summary = Hash.new(0)
    ordered_entries.each do |entry|
      if paused?
        summary[:paused] = true
        break
      end
      if scaled_down?
        summary[:drained] = true
        break
      end
      outcome = process(entry)
      summary[outcome] += 1
    end
    summary.to_h
  end

  private

  def process(entry)
    export_id = entry[:export_id]
    return :already_done if succeeded?(export_id)

    bundle, bundle_time = newest_bundle(export_id)
    unless bundle
      record(entry, status: "failed", error: "no bundle with manifest.json under #{@export_prefix}#{export_id}/")
      return :failed
    end
    return :already_checked if dry_run? && dry_run_current?(export_id, bundle_time)

    old_user_id = JSON.parse(read_object(@export_bucket, "#{bundle}/manifest.json"))["user_id"]
    claimed = with_claim(old_user_id) do
      import_bundle(entry, bundle)
    end
    claimed.nil? ? :claimed_by_other : claimed
  end

  def import_bundle(entry, bundle)
    dir = Dir.mktmpdir("user_data_import", @scratch_dir)
    started = Time.current
    begin
      download_bundle(bundle, dir)
      attempts = []
      first = dry_run? ? "dry_run" : "live"
      result = run_import(entry, dir, first)
      attempts << first
      if !result[:success] && result[:error].to_s.include?(PRIMARY_KEYS_EXIST)
        retry_mode = dry_run? ? "dry_run_skip_existing" : "skip_existing"
        result = run_import(entry, dir, retry_mode)
        attempts << retry_mode
      end
      record(entry, status: result[:success] ? "success" : "failed", attempts: attempts, started_at: started, bundle: bundle,
                    stats: result[:stats], timings: result[:timings], warnings: result[:warnings], error: result[:error])
      result[:success] ? :succeeded : :failed
    rescue StandardError => e
      record(entry, status: "failed", started_at: started, bundle: bundle, error: "#{e.class}: #{e.message}")
      :failed
    ensure
      FileUtils.remove_entry(dir) if Dir.exist?(dir)
    end
  end

  def run_import(entry, dir, mode)
    @importer.call(dir: dir, mode: mode, target_user_id: entry[:target_user_id],
                   source_bucket: @source_bucket, dest_bucket: @dest_bucket)
  end

  def default_import(dir:, mode:, target_user_id:, source_bucket:, dest_bucket:)
    UserDataImportService.call(input_dir: dir, target_user_id: target_user_id, dry_run: mode.start_with?("dry_run"),
                               skip_existing: mode.end_with?("skip_existing"),
                               source_bucket: source_bucket, dest_bucket: dest_bucket)
  end

  def dry_run?
    @mode == "dry_run"
  end

  # Claims the export with the importer's per-export named lock (same session, so the importer's own
  # GET_LOCK on that name re-enters it). Returns nil without yielding when another worker holds it.
  def with_claim(old_user_id)
    conn = ActiveRecord::Base.connection
    name = conn.quote("#{UserDataImportService::IMPORT_LOCK_NAME}:u#{old_user_id}")
    return nil unless conn.select_value("SELECT GET_LOCK(#{name}, 0)").to_i == 1

    begin
      yield
    ensure
      conn.select_value("SELECT RELEASE_LOCK(#{name})")
    end
  end

  # Higher priority first, then file order; each worker starts at its own offset so N workers spread over
  # the queue instead of all racing for the first entry.
  def ordered_entries
    entries = read_queue.each_with_index.sort_by { |e, i| [-e[:priority], i] }.map(&:first)
    return entries if entries.empty?

    offset = (entries.size * @worker_index) / @worker_count
    entries.rotate(offset)
  end

  def read_queue
    CSV.parse(read_object(@queue_bucket, "#{@queue_prefix}#{QUEUE_KEY}"), headers: true).filter_map do |row|
      export_id = row["export_id"].to_s.strip
      next if export_id.empty?

      { export_id: export_id, target_user_id: Integer(row["target_user_id"]), priority: row["priority"].to_i }
    end
  end

  def succeeded?(export_id)
    body = read_object(@queue_bucket, result_key(export_id))
    body && JSON.parse(body)["status"] == "success"
  end

  # True when the WORKERS control file asks for fewer workers than this one's index. An unreadable or
  # non-integer value is ignored (no limit), so a bad write never stops the whole pool.
  def scaled_down?
    raw = read_object(@queue_bucket, "#{@queue_prefix}#{WORKERS_KEY}")
    return false if raw.nil?

    desired = Integer(raw.strip, exception: false)
    !desired.nil? && desired >= 0 && @worker_index >= desired
  end

  def paused?
    !read_object(@queue_bucket, "#{@queue_prefix}#{PAUSE_KEY}").nil?
  end

  # A dry-run result counts as current when it succeeded and finished after the bundle was written, so a
  # re-exported (newer) bundle is checked again. A failed dry run is always retried.
  def dry_run_current?(export_id, bundle_time)
    prior = read_json(dry_run_key(export_id))
    return false unless prior && prior["status"] == "success" && prior["finished_at"].present?

    Time.iso8601(prior["finished_at"]) >= bundle_time
  rescue ArgumentError
    false
  end

  def record(entry, status:, attempts: [], started_at: nil, bundle: nil, stats: nil, timings: nil, warnings: nil, error: nil)
    finished = Time.current
    payload = {
      export_id: entry[:export_id], target_user_id: entry[:target_user_id], status: status, attempts: attempts,
      worker: @worker, started_at: started_at&.iso8601, finished_at: finished.iso8601,
      seconds: started_at ? (finished - started_at).round(1) : nil,
      mode: @mode, bundle: bundle, stats: stats, timings: timings, warnings: Array(warnings).first(dry_run? ? 1000 : 200), error: error,
    }
    key = dry_run? ? dry_run_key(entry[:export_id]) : result_key(entry[:export_id])
    @s3.put_object(bucket: @queue_bucket, key: key, body: JSON.pretty_generate(payload), content_type: "application/json")
    true
  end

  def dry_run_key(export_id)
    "#{@queue_prefix}#{DRY_RUN_PREFIX}#{export_id}.json"
  end

  def report_row(entry)
    live = read_json(result_key(entry[:export_id])) || {}
    dry = read_json(dry_run_key(entry[:export_id])) || {}
    stats = dry["stats"] || {}
    sum = ->(suffix) { stats.sum { |k, v| k.to_s.end_with?(suffix) ? v.to_i : 0 } }
    {
      export_id: entry[:export_id], target_user_id: entry[:target_user_id], priority: entry[:priority],
      live_status: live["status"], live_error: live["error"],
      dry_run_status: dry["status"], dry_run_attempts: Array(dry["attempts"]).join("+").presence,
      warnings: dry.key?("warnings") ? Array(dry["warnings"]).size : nil,
      name_conflicts: sum.call("_name_conflicts"), renamed: sum.call("_renamed"),
      id_conflicts: sum.call("_id_conflicts"), dry_run_error: dry["error"],
    }
  end

  def read_json(key)
    body = read_object(@queue_bucket, key)
    body && JSON.parse(body)
  end

  def result_key(export_id)
    "#{@queue_prefix}#{RESULTS_PREFIX}#{export_id}.json"
  end

  # The newest immediate subfolder of <export_root><id>/ that holds a manifest.json (same rule as the
  # import_user_data rake task's resolve_bundle_prefix).
  # Returns [prefix, manifest last_modified], or nil.
  def newest_bundle(export_id)
    newest = nil
    list(@export_bucket, "#{@export_prefix}#{export_id}/", delimiter: "/") do |page|
      page.common_prefixes.each do |cp|
        sub = cp.prefix.chomp("/")
        head = head_or_nil(@export_bucket, "#{sub}/manifest.json")
        newest = [sub, head.last_modified] if head && (newest.nil? || head.last_modified > newest[1])
      end
    end
    newest
  end

  def download_bundle(prefix, dir)
    keys = []
    list(@export_bucket, "#{prefix}/") { |page| page.contents.each { |o| keys << o.key unless o.key.end_with?("/") } }
    queue = Queue.new
    keys.each { |k| queue << k }
    Array.new([DOWNLOAD_THREADS, keys.size].min) do
      Thread.new do
        while (key = begin
          queue.pop(true)
        rescue ThreadError
          nil
        end)
          @s3.get_object(bucket: @export_bucket, key: key, response_target: File.join(dir, File.basename(key)))
        end
      end
    end.each(&:join)
    keys.size
  end

  def list(bucket, prefix, delimiter: nil)
    token = nil
    loop do
      page = @s3.list_objects_v2(bucket: bucket, prefix: prefix, delimiter: delimiter, continuation_token: token)
      yield page
      break unless page.is_truncated

      token = page.next_continuation_token
    end
  end

  def read_object(bucket, key)
    @s3.get_object(bucket: bucket, key: key).body.read
  rescue Aws::S3::Errors::NoSuchKey, Aws::S3::Errors::NotFound
    nil
  end

  def head_or_nil(bucket, key)
    @s3.head_object(bucket: bucket, key: key)
  rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchKey
    nil
  end

  def split_uri(uri)
    bucket, prefix = S3Util.parse_s3_path(uri.to_s)
    raise ConfigError, "expected s3://bucket/prefix/, got #{uri.inspect}" if bucket.blank?

    prefix = prefix.to_s
    prefix = "#{prefix}/" unless prefix.empty? || prefix.end_with?("/")
    [bucket, prefix]
  end
end

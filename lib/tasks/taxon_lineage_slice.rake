require "zlib"
require "stringio"

namespace :taxon_lineage_slice do
  # Version + source file are ENV-overridable so an environment can load the FULL taxon
  # lineage (all ~3M rows) instead of the dev/test *slice*, WITHOUT a code change (Forgejo
  # #528 — the slice omits taxid 694009 and ~20k other taxa, surfacing as
  # TaxonLineage::LineageNotFoundError + taxon-indexing lambda failures). Defaults preserve
  # the historical slice behavior exactly; to switch an env to the full lineage, set in its
  # web-params:
  #   TAXON_LINEAGE_FILE_KEY = ncbi-indexes-prod/2024-02-06/index-generation-2/<full-lineage>.csv
  #   (optionally TAXON_LINEAGE_VERSION if the full file is a different lineage version)
  # then run the one-time replace: taxon_lineage_slice:remove_slice -> import_data_from_s3 ->
  # create_taxon_lineage_slice_es_index (rebuilds MySQL + OpenSearch from the full table).
  # See docs/TAXON-LINEAGE-FULL-CUTOVER.md.
  CURRENT_VERSION = (ENV["TAXON_LINEAGE_VERSION"].presence || "2024-02-06").freeze
  SLICE_NAME = "taxon_lineages_2024_slice.csv".freeze
  INDEXES_PREFIX = "ncbi-indexes-prod/#{CURRENT_VERSION}/index-generation-2".freeze
  TAXON_LINEAGE_FILE_KEY = (ENV["TAXON_LINEAGE_FILE_KEY"].presence || "#{INDEXES_PREFIX}/#{SLICE_NAME}").freeze

  # These are long-running offline jobs. Their DB connection can be dropped by the
  # server ("Server has gone away") between chunks, surfacing as
  # ActiveRecord::StatementInvalid / ConnectionNotEstablished (Forgejo #388).
  # Wrap the risky DB work so we reconnect once and retry before giving up.
  # Delegates to the shared DbConnection helper (#496) so the reconnect-and-retry
  # logic lives in one place; the call sites below are unchanged.
  def self.with_db_reconnect(context, max_retries: 2, &block)
    DbConnection.with_reconnect(context, max_retries: max_retries, &block)
  end

  # OpenSearch/ES rejects a sustained burst of `_bulk` writes with 429 ("Too Many
  # Requests" / rejected execution -- queue full) when the full ~4.75M-row lineage is
  # indexed back-to-back against a small (e.g. single-node dev) domain (#551). Without a
  # retry the whole rebuild aborts and leaves a half-built index. Retry the batch with
  # exponential backoff (capped) so a transient rejection rides through. Matched by class
  # name (string) so we don't depend on the transport gem's error classes being loaded.
  ES_RETRYABLE_CLASSES = %w[
    Elasticsearch::Transport::Transport::Errors::TooManyRequests
    Elasticsearch::Transport::Transport::Errors::ServiceUnavailable
    Elasticsearch::Transport::Transport::ServerError
  ].freeze

  def self.with_es_retry(context, max_retries: 5)
    attempts = 0
    begin
      yield
    rescue StandardError => exception
      retryable = ES_RETRYABLE_CLASSES.include?(exception.class.name) ||
                  exception.message.to_s.match?(/\b429\b|Too Many Requests|rejected execution/i)
      raise unless retryable

      attempts += 1
      raise if attempts > max_retries

      sleep_s = [2**(attempts - 1), 16].min
      puts "  ES bulk rejected during #{context} (#{exception.class}: #{exception.message.to_s[0, 120]}); backoff #{sleep_s}s (attempt #{attempts}/#{max_retries})."
      sleep(sleep_s)
      retry
    end
  end

  # Bulk-index the loaded TaxonLineage rows into OpenSearch (#478). The full ~4.75M-row
  # rebuild was single-threaded: sequential _bulk calls bound throughput to one in-flight
  # request. This runs up to TAXON_ES_BULK_CONCURRENCY _bulk calls concurrently for a
  # near-linear speedup up to the domain's ingest ceiling.
  #
  # Threading model: the DB read (find_in_batches) and the per-record as_indexed_json
  # serialization stay on THIS thread -- ActiveRecord connections are not safe to share
  # across threads -- so the producer builds each batch's request body and hands only the
  # (plain-Hash) body to the worker pool. Worker threads do nothing but the independent
  # _bulk HTTP call, each still riding the #551 429 backoff (with_es_retry).
  #
  # Concurrency is ENV-tunable with a CONSERVATIVE default of 1 (serial -- byte-for-byte the
  # previous behavior) so a small single-node dev OpenSearch domain is never overloaded on a
  # plain rebuild. Raise TAXON_ES_BULK_CONCURRENCY (e.g. 4-8) on multi-node staging/prod
  # domains; the 429 backoff keeps it safe even if the value overshoots the ceiling.
  def self.bulk_index_taxon_lineage(es, index, batch_size)
    concurrency = [(ENV["TAXON_ES_BULK_CONCURRENCY"].presence || 1).to_i, 1].max

    build_body = lambda do |group|
      group.map { |rec| { index: { _index: index, _id: rec.id, data: rec.__elasticsearch__.as_indexed_json } } }
    end
    index_body = lambda do |body|
      resp = with_es_retry("bulk index") { es.client.bulk(body: body) }
      puts "  WARN: some docs failed to index in a batch" if resp && resp["errors"]
    end

    if concurrency == 1
      TaxonLineage.find_in_batches(batch_size: batch_size) { |group| index_body.call(build_body.call(group)) }
      return
    end

    puts "Parallel bulk index: #{concurrency} concurrent _bulk streams (TAXON_ES_BULK_CONCURRENCY)."
    # Bounded producer/consumer: the queue holds at most `concurrency` pending batches so
    # memory stays bounded no matter how far ahead the DB reader runs. The first worker
    # error is captured and re-raised on this thread AFTER draining, so the caller's `ensure`
    # (which restores the index settings) still runs and no half-built state is hidden.
    #
    # A worker exits ONLY on the nil sentinel -- never on error. If a failed worker died
    # early, the queue (already full at `concurrency`) would have no consumer and the
    # producer's / sentinel's `push` would block forever (deadlock). So once an error is
    # recorded, workers keep popping and discarding until the sentinels arrive; the producer
    # stops enqueuing real work as soon as it sees the error.
    queue = SizedQueue.new(concurrency)
    mutex = Mutex.new
    error = nil
    workers = Array.new(concurrency) do
      Thread.new do
        while (body = queue.pop)
          next if mutex.synchronize { !error.nil? } # drain-and-discard after a failure

          begin
            index_body.call(body)
          rescue StandardError => e
            mutex.synchronize { error ||= e }
          end
        end
      end
    end

    begin
      TaxonLineage.find_in_batches(batch_size: batch_size) do |group|
        break if mutex.synchronize { !error.nil? }

        queue.push(build_body.call(group))
      end
    ensure
      concurrency.times { queue.push(nil) } # one sentinel per worker so each exits its loop
      workers.each(&:join)
    end

    raise error if error
  end

  desc "Seed 2024 taxon lineage data"
  task import_data_from_s3: :environment do
    # Long-running S3 import: on deploy/rollout the pod may be sent SIGTERM. Trap it
    # so we exit cleanly instead of raising `SignalException: SIGTERM` to Sentry
    # (Forgejo #388). The job is idempotent (guarded by the exists? check) and safe
    # to re-run on the next deploy.
    trap('SIGTERM') do
      puts "Received SIGTERM; aborting taxon lineage import cleanly (safe to re-run)."
      exit(0)
    end

    puts "Inserting #{CURRENT_VERSION} taxon lineage slice, this could take a while"

    if TaxonLineage.exists?(version_start: CURRENT_VERSION)
      abort("Taxon Lineage data for #{CURRENT_VERSION} already exists")
    end

    print "Connecting to Taxon Lineage S3 bucket [#{S3_DATABASE_BUCKET}] key [#{TAXON_LINEAGE_FILE_KEY}]"
    s3 = Aws::S3::Client.new
    response = s3.get_object(bucket: S3_DATABASE_BUCKET, key: TAXON_LINEAGE_FILE_KEY)
    print "Importing Taxon Lineage data from S3"

    chunk_size = 10_000
    rows = []
    counter = 0

    csv_data = response.body.read # Read the data once
    # The FULL lineage export (versioned-taxid-lineages.csv.gz, #528) is gzipped; the dev
    # slice is plain CSV. Transparently gunzip when the key is .gz so the same loader serves
    # both. (Whole-file in memory, as before — size the taxon-load Job's memory for the full
    # ~GB uncompressed set.)
    csv_data = Zlib::GzipReader.new(StringIO.new(csv_data)).read if TAXON_LINEAGE_FILE_KEY.end_with?(".gz")
    # Count data rows for the progress log WITHOUT materializing every CSV::Row. The full
    # lineage is ~4.75M rows; `CSV.parse(csv_data).count` builds the entire array in memory
    # just to count it — a multi-GB spike that can OOM the load (and OOM-ing *after* the
    # delete step would leave the env with no taxon data). A newline count is close enough
    # for a percentage (#528).
    total_rows = [csv_data.count("\n") - 1, 1].max # Count rows for progress tracking

    # The full versioned lineage export (#528) ships invalid created_at values — some blank,
    # many the MySQL zero-date "0000-00-00 00:00:00" (the slice had real timestamps). insert_all
    # skips Rails' timestamp defaulting, ActiveRecord type-casts a zero-date to nil, and both
    # columns are NOT NULL — so one bad row aborts the whole import with NotNullViolation,
    # leaving the table empty after the remove step. Keep only real YYYY-MM-DD timestamps;
    # default anything else (blank / 0000- / garbage) to load time.
    now_ts = Time.now.utc.strftime("%Y-%m-%d %H:%M:%S")
    # Process the CSV in chunks to avoid memory issues
    CSV.parse(csv_data, headers: true) do |row|
      h = row.to_h.transform_values(&:to_s)
      %w[created_at updated_at].each { |c| h[c] = now_ts unless h[c].to_s.match?(/\A[12]\d{3}-\d{2}-\d{2}/) }
      rows << h
      if rows.size >= chunk_size
        # Inserting in bulk for performance reasons
        # rubocop:disable Rails/SkipsModelValidations
        with_db_reconnect("taxon lineage chunk insert") { TaxonLineage.insert_all(rows) }
        # rubocop:enable Rails/SkipsModelValidations
        rows.clear # Clear the array to free up memory and prepare for the next chunk
        counter += chunk_size
        puts "#{(counter.to_f / total_rows) * 100}% of rows imported"
      end
    end

    # Insert any remaining rows that didn't fill up the last chunk
    unless rows.empty?
      # rubocop:disable Rails/SkipsModelValidations
      with_db_reconnect("taxon lineage final chunk insert") { TaxonLineage.insert_all(rows) }
      # rubocop:enable Rails/SkipsModelValidations
      counter += rows.size
      puts "#{(counter.to_f / total_rows) * 100}% of rows imported"
    end
  end

  task remove_slice: :environment do
    puts "Removing #{CURRENT_VERSION} taxon lineage rows"
    # Use delete_all (single SQL DELETE), not destroy_all: TaxonLineage is reference data
    # with no destroy callbacks, and destroy_all instantiates + deletes row-by-row — on a
    # multi-million-row table that is pathologically slow and can outlive the DB connection.
    # Wrapped in with_db_reconnect so a large single DELETE that trips "Server has gone away"
    # reconnects + retries rather than raising (Forgejo #388/#528).
    with_db_reconnect("remove_slice") do
      TaxonLineage.where(version_end: CURRENT_VERSION).delete_all
    end
  end

  # One-command full reload (#528): clear the current version's rows, re-import from S3
  # (gunzip-aware, honoring TAXON_LINEAGE_FILE_KEY), and rebuild the OpenSearch index from
  # the freshly-loaded table. This is the clean, resumable path for the slice->full cutover
  # and any future reference-data refresh — run it from a detached one-off Job, not a shell
  # exec. See docs/TAXON-LINEAGE-FULL-CUTOVER.md.
  desc "Full reload: delete current-version rows -> import from S3 (gunzip-aware) -> rebuild ES index"
  task reload_from_s3: :environment do
    puts "Reloading taxon lineage #{CURRENT_VERSION} from s3://#{S3_DATABASE_BUCKET}/#{TAXON_LINEAGE_FILE_KEY}"
    puts "  step 1/3 - clearing current #{CURRENT_VERSION} rows"
    Rake::Task["taxon_lineage_slice:remove_slice"].invoke
    puts "  step 2/3 - importing from S3"
    Rake::Task["taxon_lineage_slice:import_data_from_s3"].invoke
    puts "  step 3/3 - rebuilding the OpenSearch index"
    # The DB load above is already committed. The search-index rebuild is best-effort:
    # skip it when OpenSearch is off, and never let an ES failure fail (and, with the
    # remove step at the top, churn) an otherwise-successful data load (#549). Lineage
    # lookups + pathogen flagging read MySQL, not OpenSearch.
    if defined?(ELASTICSEARCH_ON) && ELASTICSEARCH_ON
      begin
        Rake::Task["taxon_lineage_slice:create_taxon_lineage_slice_es_index"].invoke
      rescue StandardError => e
        puts "  ⚠ OpenSearch rebuild failed (#{e.class}: #{e.message}). The DB load is committed + complete; rebuild the search index separately (#549/#550)."
      end
    else
      puts "  ELASTICSEARCH_ON is off; skipping the OpenSearch rebuild. The DB load is complete."
    end
    puts "Reload complete for #{CURRENT_VERSION} (#{TaxonLineage.where(version_start: CURRENT_VERSION).count} rows for this version_start)."
  end

  task create_taxon_lineage_slice_es_index: :environment do
    puts "Creating Elasticsearch index for #{CURRENT_VERSION} slice of TaxonLineage data"
    es = TaxonLineage.__elasticsearch__
    es.create_index!(force: true)

    # Bulk-load tuning (#477): during the import, disable per-batch refresh, drop replicas,
    # and set translog durability to async so OpenSearch spends its I/O on ingest, not on
    # refreshing segments, replicating every doc, or fsync-ing the translog on every _bulk
    # request. Capture the index's original settings first and restore them in an `ensure`
    # (so a failed import can't leave the index un-refreshed, under-replicated, or on a
    # weaker durability than it started with). Larger `batch_size` = fewer, bigger `_bulk`
    # requests. translog.durability is not returned by get_settings when it is at its
    # default, so default the restore value to "request" (the OpenSearch default).
    index = es.index_name
    current = es.client.indices.get_settings(index: index).values.first["settings"]["index"]
    restore = {
      refresh_interval: current["refresh_interval"] || "1s",
      number_of_replicas: current["number_of_replicas"] || "1",
      "translog.durability": current.dig("translog", "durability") || "request",
    }
    puts "Bulk-load tuning: refresh_interval=-1, number_of_replicas=0, translog.durability=async during import; restoring #{restore} after."
    es.client.indices.put_settings(index: index, body: { index: { refresh_interval: -1, number_of_replicas: 0, "translog.durability": "async" } })
    begin
      # elasticsearch-model 7.1.1's `import` delegates find_in_batches through a proxy that
      # is NOT Ruby-3 keyword-safe (the app runs Ruby 3.3) — `es.import` raises
      # ArgumentError "wrong number of arguments (given 1, expected 0)" (#550). Bulk-index
      # directly via ActiveRecord find_in_batches + es.client.bulk, bypassing the broken
      # proxy path entirely.
      # Batch size is ENV-tunable (#551) so a constrained domain can throttle down; each
      # batch's _bulk call retries on 429 with backoff instead of aborting the rebuild.
      # Concurrency is ENV-tunable (#478); each concurrent _bulk stream rides the same 429
      # backoff. See bulk_index_taxon_lineage for the threading model.
      batch_size = (ENV["TAXON_ES_BULK_BATCH"].presence || 5000).to_i
      bulk_index_taxon_lineage(es, index, batch_size)
    ensure
      es.client.indices.put_settings(index: index, body: { index: restore })
      es.client.indices.refresh(index: index)
    end
    puts "Finished indexing TaxonLineage."
  end

  task remove_taxon_lineage_slice_es_index: :environment do
    puts "Removing Elasticsearch index for #{CURRENT_VERSION} slice of TaxonLineage data"
    TaxonLineage.__elasticsearch__.delete_index!
    puts "Finished removing TaxonLineage index"
  end

  # Idempotent, deploy-safe loader used by the Helm taxon-load Job (ticket #471).
  # A fresh deploy has no taxon lineage data, which breaks reports/taxonomy/heatmaps.
  # This runs at deploy time (PreSync hook, after db:migrate) and:
  #   * imports the taxon lineage slice from S3 ONLY if it isn't already loaded, and
  #   * (re)builds the OpenSearch/ES index so it matches the loaded data.
  # Unlike import_data_from_s3, it NEVER aborts/non-zeros when data already exists,
  # so re-running on every deploy is a no-op instead of a failed Job. It is safe to
  # run before web/workers come up.
  desc "Idempotently load the taxon lineage slice + build its ES index (deploy hook)"
  task load_slice_if_needed: :environment do
    # Preview sandboxes read the FULL lineage from a shared schema via a VIEW instead of
    # loading a per-PR slice (platform-overhaul 731). When TAXON_LINEAGE_REF_SCHEMA is set
    # (sandbox preview values), attach the view and skip BOTH the slice import and the ES
    # rebuild below -- a sandbox's ES client reads dev's shared taxon_lineages_alias, so it
    # has no index of its own to (re)build here. Dev/staging/prod leave the var unset and
    # keep the existing slice/full-load behavior unchanged.
    if ENV["TAXON_LINEAGE_REF_SCHEMA"].present?
      puts "TAXON_LINEAGE_REF_SCHEMA=#{ENV['TAXON_LINEAGE_REF_SCHEMA']} set; attaching shared-lineage view (sandbox)."
      Rake::Task["sandbox_lineage_ref:attach"].invoke
      next
    end

    # Completeness guard (#528, Issue 2). The old presence-only `exists?` check skipped
    # re-import once ANY row for the version existed, so a partial/truncated import (e.g. a
    # pod SIGTERM'd mid-load) was permanently masked — taxid 694009 went missing on dev for
    # exactly this reason. When TAXON_LINEAGE_MIN_ROWS is set (recommended: the source row
    # count for the full lineage), require the loaded count to meet it; a short load is
    # treated as incomplete, its rows cleared, and re-imported. Falls back to presence-only
    # when unset, so existing envs are unchanged until they opt in.
    min_rows = ENV["TAXON_LINEAGE_MIN_ROWS"].to_i
    loaded = TaxonLineage.where(version_start: CURRENT_VERSION).count
    complete = min_rows.positive? ? (loaded >= min_rows) : loaded.positive?
    if complete
      puts "Taxon lineage #{CURRENT_VERSION} present with #{loaded} rows#{min_rows.positive? ? " (>= #{min_rows})" : ''}; skipping import."
    else
      puts "Taxon lineage #{CURRENT_VERSION} missing or incomplete (#{loaded} rows#{min_rows.positive? ? " < #{min_rows}" : ''}); importing from S3."
      # A partial prior load leaves rows that would collide with the fresh import; clear them first.
      Rake::Task["taxon_lineage_slice:remove_slice"].invoke if loaded.positive?
      Rake::Task["taxon_lineage_slice:import_data_from_s3"].invoke
    end

    unless defined?(ELASTICSEARCH_ON) && ELASTICSEARCH_ON
      puts "Elasticsearch disabled (ELASTICSEARCH_ON is false); skipping index build."
      next
    end

    # Guard the (~53 min) ES rebuild (#476). This runs as an Argo PreSync hook on
    # EVERY deploy; the old code unconditionally called create_index!(force: true) +
    # a full re-import, which DROPS the index first — so taxonomy/heatmap were degraded
    # for the whole rebuild on every single deploy. Only (re)build when the index is
    # missing or its doc-count is out of sync with the DB. On ANY check error we fall
    # through to a rebuild — the safe default (never leaves a stale or missing index).
    es = TaxonLineage.__elasticsearch__
    db_count = TaxonLineage.count
    in_sync =
      begin
        es.client.indices.exists?(index: es.index_name) &&
          es.client.count(index: es.index_name)["count"].to_i == db_count
      rescue StandardError => e
        puts "ES index sync-check failed (#{e.class}: #{e.message}); will rebuild to be safe."
        false
      end

    if in_sync
      puts "ES index #{es.index_name} already built and in sync with the DB (#{db_count} docs); skipping rebuild."
    else
      puts "ES index missing or out of sync with the DB; (re)building."
      # Best-effort (#551): a search-index rebuild hiccup -- e.g. OpenSearch 429 under load,
      # or the 429 exhausting the per-batch retries above -- must never fail this deploy hook
      # or 500 the app. Lineage lookups + pathogen flagging read MySQL, which is already
      # loaded; the search index can be rebuilt out-of-band via
      # `rake taxon_lineage_slice:create_taxon_lineage_slice_es_index`. Log loudly and carry on.
      begin
        Rake::Task["taxon_lineage_slice:create_taxon_lineage_slice_es_index"].invoke
      rescue StandardError => e
        puts "  ⚠ ES index rebuild failed (#{e.class}: #{e.message}); DB data is intact, search index left as-is. Rebuild out-of-band. See #551/#549."
      end
    end
    puts "Taxon lineage load complete."
  end
end

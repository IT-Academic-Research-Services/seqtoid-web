# frozen_string_literal: true

# Runs the CZI user-data import queue (UserDataImportQueue) -- the next-prod backfill runner. One process =
# one worker making one pass over the queue; run N at once as a Kubernetes Indexed Job (the completion index
# picks each worker's starting offset). Requires IMPORT_REQUIRE_DB_HOST (the target database) and, for N > 1,
# IMPORT_LOCK_SCOPE=export. Results land in <queue>/results/<export_id>.json; re-running retries only the
# exports that have not succeeded.
#
#   rake 'import_queue:run[s3://bucket/queues/backfill-1/,s3://transfer-bucket/user_data_exports/,src-samples-bucket,dest-samples-bucket]'
namespace :import_queue do
  desc "Import the CZI user-data export queue (next-prod backfill runner)"
  task :run, [:queue_uri, :export_root, :source_bucket, :dest_bucket] => :environment do |_t, args|
    abort "Usage: rake 'import_queue:run[<queue s3 uri>,<export root s3 uri>,<source bucket>,<dest bucket>]'" if args[:queue_uri].blank? || args[:export_root].blank?

    index = Integer(ENV.fetch("JOB_COMPLETION_INDEX", "0"))
    count = Integer(ENV.fetch("IMPORT_QUEUE_WORKERS", "1"))
    if count > 1 && ENV["IMPORT_LOCK_SCOPE"] != "export"
      abort "IMPORT_QUEUE_WORKERS=#{count} needs IMPORT_LOCK_SCOPE=export (otherwise the workers serialize on the global import lock)"
    end

    summary = UserDataImportQueue.new(
      queue_uri: args[:queue_uri], export_root: args[:export_root],
      source_bucket: args[:source_bucket], dest_bucket: args[:dest_bucket],
      worker: "w#{index}@#{Socket.gethostname}", worker_index: index, worker_count: count
    ).run
    puts "IMPORT_QUEUE_SUMMARY #{summary.to_json}"
  end
end

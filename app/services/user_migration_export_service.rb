require "tmpdir"

# Source-side orchestrator for migrating one user OUT to a partner instance.
# Coordinates the two halves that run on the source system, both landing in the
# partner's DESTINATION bucket so the partner retrieves everything from one place:
#
#   1. DB bundle  -- UserDataExportService streams the user's whole graph to a
#      temp dir; the bundle is uploaded to the destination (partner) bucket.
#   2. S3 files   -- S3TransferDispatchService copies the user's transferable
#      output objects to the same destination bucket (per
#      config/s3_transfer_file_policy.yml).
#
# It does NOT import: that runs on the partner (destination) instance, invoking
# UserDataImportService with source_bucket/dest_bucket so stored URIs are rewritten
# to the partner bucket. The returned summary includes everything the partner
# needs to run that import.
class UserMigrationExportService
  include Callable

  class DestinationBucketMissingError < StandardError
    def initialize
      super("No destination bucket configured (pass destination_bucket: or set S3_TRANSFER_DESTINATION_BUCKET).")
    end
  end

  BUNDLE_PREFIX = "user_data_exports".freeze

  # destination_bucket defaults to the same env var the S3 transfer dispatch uses,
  # so the orchestrator knows where everything goes: the DB bundle and the copied
  # output files land together in the partner bucket.
  def initialize(user_id, destination_bucket: nil, run_transfer: true, timestamp: nil)
    @user_id = user_id
    @destination_bucket = (destination_bucket || ENV["S3_TRANSFER_DESTINATION_BUCKET"]).presence
    @run_transfer = run_transfer
    # Injectable for deterministic prefixes in tests; defaults to now.
    @timestamp = timestamp || Time.now.utc.strftime("%Y%m%d%H%M%S")
  end

  def call
    raise DestinationBucketMissingError if @destination_bucket.blank?

    summary = nil
    Dir.mktmpdir("user_migration_export") do |dir|
      export = UserDataExportService.call(user_id: @user_id, output_dir: dir)
      # Dispatch the file copy first so a misconfigured transfer fails before we
      # upload the bundle (avoids an orphaned bundle in the partner bucket).
      transfer_job = @run_transfer ? S3TransferDispatchService.call(@user_id) : nil
      bundle_key_prefix = upload_bundle(dir, export[:files])

      summary = {
        user_id: @user_id,
        schema_version: export[:schema_version],
        table_counts: export[:table_counts],
        destination_bucket: @destination_bucket,
        bundle_s3_uri: "s3://#{@destination_bucket}/#{bundle_key_prefix}",
        transfer_job_id: transfer_job&.id,
        transfer_file_count: transfer_job&.file_count,
        warnings: export[:warnings],
      }
    end
    summary
  rescue StandardError => e
    LogUtil.log_error("Error orchestrating migration export for user #{@user_id}", exception: e)
    raise
  end

  private

  # Uploads every bundle file to the destination (partner) bucket and returns the
  # key prefix it wrote under. Uses the resource-level uploader, which switches to
  # multipart for large files (a big contigs.ndjson.gz can exceed the 5 GB
  # single-PUT limit).
  def upload_bundle(dir, files)
    key_prefix = "#{BUNDLE_PREFIX}/#{@user_id}/migration_#{@timestamp}"
    s3 = Aws::S3::Resource.new(client: AwsClient[:s3])
    files.each do |filename|
      s3.bucket(@destination_bucket).object("#{key_prefix}/#{filename}").upload_file(File.join(dir, filename))
    end
    key_prefix
  end
end

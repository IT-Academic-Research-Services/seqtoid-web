# frozen_string_literal: true

# Source-side migration: export a user's DB bundle AND dispatch the S3 file
# transfer, both landing in the partner's DESTINATION bucket. Import runs
# separately on the partner instance (see the printed command). Usage:
#   rake migrate_user_out[<user_id>]
#   rake migrate_user_out[<user_id>,<destination_bucket>]
# destination_bucket defaults to S3_TRANSFER_DESTINATION_BUCKET.
task :migrate_user_out, [:user_id, :destination_bucket] => :environment do |_t, args|
  user_id = args[:user_id]&.to_i
  destination_bucket = args[:destination_bucket].presence

  if user_id.blank? || user_id.zero?
    puts "Usage: rake migrate_user_out[<user_id>]"
    exit 1
  end

  puts "=" * 60
  puts "USER MIGRATION (source side): export bundle + dispatch S3 transfer"
  puts "=" * 60
  puts "User: #{user_id}"
  puts ""

  result = UserMigrationExportService.call(user_id, destination_bucket: destination_bucket)

  puts "DB bundle uploaded:   #{result[:bundle_s3_uri]}"
  puts "Destination bucket:   #{result[:destination_bucket]}"
  puts "Schema version:       #{result[:schema_version]}"
  puts "S3 transfer job:      ##{result[:transfer_job_id]} (#{result[:transfer_file_count]} files -> #{result[:destination_bucket]})"
  puts "Poll status:          PollS3TransferJobs runs every 5m; or check S3TransferJob ##{result[:transfer_job_id]}"
  if result[:warnings].present?
    puts "Warnings (#{result[:warnings].size}):"
    result[:warnings].first(10).each { |w| puts "  - #{w}" }
  end
  puts ""
  puts "Row counts by table:"
  (result[:table_counts] || {}).sort_by { |_t, c| -c }.each { |t, c| puts "  #{t}: #{c}" if c.positive? }
  puts ""
  puts "-" * 60
  puts "NEXT: on the PARTNER instance, once the S3 transfer job SUCCEEDS, retrieve"
  puts "the bundle from the destination bucket to a local <dir>:"
  puts ""
  puts "  aws s3 cp --recursive #{result[:bundle_s3_uri]} <dir>"
  puts ""
  puts "then import with the bucket rewrite:"
  puts ""
  puts "  rake import_user_data[<dir>,live,new,#{SAMPLES_BUCKET_NAME},#{result[:destination_bucket]}]"
  puts ""
  puts "(source_bucket=#{SAMPLES_BUCKET_NAME} -> dest_bucket=#{result[:destination_bucket]})"
end

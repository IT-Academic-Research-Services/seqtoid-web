# frozen_string_literal: true

require "benchmark"

# Peak resident set size (MB) of this process, read from /proc/self/status (Linux
# container/pod). Returns nil on platforms without /proc (e.g. local macOS host).
def peak_rss_mb
  status = "/proc/self/status"
  return nil unless File.exist?(status)

  line = File.foreach(status).find { |l| l.start_with?("VmHWM:") }
  line ? (line.split[1].to_f / 1024).round(1) : nil # VmHWM is in kB
end

# Total bytes across the export bundle's files.
def dir_size_mb(dir)
  bytes = Dir.glob(File.join(dir, "*")).sum { |f| File.file?(f) ? File.size(f) : 0 }
  (bytes.to_f / (1024 * 1024)).round(2)
end

desc "Export user data by ID or email to a streaming NDJSON bundle. " \
     "Usage: rake export_user_data[355] or rake export_user_data[user@example.com]"
task :export_user_data, [:identifier] => :environment do |_t, args|
  identifier = args[:identifier]

  if identifier.blank?
    puts "Error: Please provide a user ID or email"
    puts "Usage: rake export_user_data[355]"
    puts "       rake export_user_data[user@example.com]"
    exit 1
  end

  # Find user by ID or email
  user = if identifier.match?(/\A\d+\z/)
           User.find_by(id: identifier.to_i)
         else
           User.find_by(email: identifier)
         end

  unless user
    puts "Error: User not found with identifier: #{identifier}"
    exit 1
  end

  # Write the bundle to a durable location. On the migration hosts /mnt is a
  # bind-mounted host volume that survives the (--rm) container, so the bundle is
  # retrievable on the box even before the S3 upload. Falls back to the repo root
  # locally.
  base_dir = Dir.exist?("/mnt") ? "/mnt/user_data_exports" : Rails.root.join("tmp", "user_data_exports").to_s
  timestamp = Time.current.strftime("%Y%m%dT%H%M%SZ")
  output_dir = File.join(base_dir, user.id.to_s, "user_#{user.id}_export_#{timestamp}")

  puts "Exporting data for user: #{user.email} (ID: #{user.id})"
  puts "Output dir: #{output_dir}"
  puts "=" * 60

  result = nil
  export_seconds = Benchmark.realtime { result = UserDataExportService.call(user_id: user.id, output_dir: output_dir) }

  # Output summary
  puts "Export completed!"
  puts ""
  puts "Summary:"
  puts "  Schema version: #{result[:schema_version]}"
  puts "  User ID: #{result[:user_id]}"
  puts ""
  puts "  Rows by table:"
  result[:table_counts].sort_by { |_table, count| -count }.each do |table, count|
    puts "    #{table}: #{count}" if count > 0
  end
  puts ""

  # Upload the whole bundle under a per-user, per-export prefix.
  bucket = ENV["SAMPLES_BUCKET_NAME_V1"]
  s3_prefix = nil
  s3_seconds = 0.0
  if bucket.present?
    s3_prefix = "user_data_exports/#{user.id}/user_#{user.id}_export_#{timestamp}"
    s3_seconds = Benchmark.realtime do
      result[:files].each do |filename|
        S3Util.upload_file(bucket, "#{s3_prefix}/#{filename}", File.join(output_dir, filename))
      end
    rescue StandardError => e
      puts "WARNING: S3 upload failed (#{e.class}: #{e.message}); local bundle retained at #{output_dir}."
      s3_prefix = nil
    end
    puts "Uploaded bundle to: s3://#{bucket}/#{s3_prefix}/" if s3_prefix
  else
    puts "SAMPLES_BUCKET_NAME_V1 not set; skipping S3 upload (local bundle only at #{output_dir})."
  end

  # Performance instrumentation (used to size large-user migrations).
  bundle_mb = dir_size_mb(output_dir)
  rss = peak_rss_mb
  puts ""
  puts "Performance:"
  puts "  Export (stream + gzip):  #{export_seconds.round(2)}s"
  puts "  S3 upload:               #{s3_seconds.round(2)}s"
  puts "  Bundle size (gzipped):   #{bundle_mb} MB"
  puts "  Peak RSS:                #{rss ? "#{rss} MB" : 'n/a (no /proc)'}"
  puts ""
  puts "Bundle files:"
  result[:files].each do |filename|
    fpath = File.join(output_dir, filename)
    fmb = (File.size(fpath).to_f / (1024 * 1024)).round(2)
    puts "  #{filename}: #{fmb} MB"
  end
end

# Register (idempotently) an AlignmentConfig for a taxonomy/index version from its S3 artifacts, so a
# new reference version is adopted by an automated task instead of a hand-edited seed + db:seed
# (epic #548 refresh pipeline 3/6). Validates the required index files actually exist before writing
# the row -- a config that points at missing indexes would silently break every pipeline run.
#
# Two cadences:
#   LINEAGE-ONLY (quarterly, default when BASE_CONFIG is set): reuse the NT/NR sequence paths from an
#     existing config, override only the lineage paths + version.
#   FULL (annual NT/NR rebuild): derive every path from the version's index-generation-2 dir.
#
# Usage:
#   BASE_CONFIG=2024-02-06 rake 'alignment_config:register[2026-07-09]'   # lineage-only
#   rake 'alignment_config:register[2026-07-09]'                          # full (NT/NR rebuilt)
#   PREFIX=ncbi-indexes-prod  (default)   DRY_RUN=1  (validate + print, don't write)
require Rails.root.join("lib/alignment_config_builder").to_s

namespace :alignment_config do
  desc "Register/upsert an AlignmentConfig for a version from its S3 index artifacts (idempotent)"
  task :register, [:version, :prefix] => :environment do |_t, args|
    b = AlignmentConfigBuilder
    version = (args[:version] || ENV["VERSION"]).to_s.strip
    prefix  = (args[:prefix]  || ENV["PREFIX"]).presence || "ncbi-indexes-prod"
    base_config_name = ENV["BASE_CONFIG"].presence
    abort("alignment_config:register requires a version") if version.empty?

    s3 = Aws::S3::Client.new
    bucket = S3_DATABASE_BUCKET

    # Build the target attributes for the chosen cadence.
    if base_config_name
      base = AlignmentConfig.find_by(name: base_config_name)
      abort("BASE_CONFIG '#{base_config_name}' not found -- cannot reuse its sequence paths") if base.nil?
      attrs = b.lineage_only_attributes(version: version, bucket: bucket,
                                        base_attrs: base.attributes.symbolize_keys, prefix: prefix)
      required_keys = b.lineage_object_keys(version: version, prefix: prefix)
      puts "[alignment_config:register] LINEAGE-ONLY version=#{version} (sequence paths reused from #{base_config_name})"
    else
      attrs = b.derive_attributes(version: version, bucket: bucket, prefix: prefix)
      required_keys = b.required_object_keys(version: version, prefix: prefix)
      puts "[alignment_config:register] FULL version=#{version} (all paths derived from index-generation-2)"
    end

    # Validate the required index files exist before touching the DB.
    missing = required_keys.reject do |key|
      s3.head_object(bucket: bucket, key: key)
      true
    rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchKey
      false
    end
    unless missing.empty?
      abort("alignment_config:register: required index artifacts missing in s3://#{bucket}/:\n  " +
            missing.join("\n  "))
    end
    puts "  validated #{required_keys.size} required index artifact(s) present"

    if ENV["DRY_RUN"] == "1"
      puts "  DRY_RUN -- would upsert AlignmentConfig(name=#{version}):"
      attrs.sort.each { |k, v| puts "    #{k} = #{v}" }
      next
    end

    config = AlignmentConfig.find_or_initialize_by(name: version)
    action = config.new_record? ? "created" : "updated"
    config.assign_attributes(attrs)
    config.save!
    puts "[alignment_config:register] #{action} AlignmentConfig(id=#{config.id}, name=#{version}, lineage_version=#{version})."
    puts "  NOTE: this does NOT flip the default. Cutover = set AppConfig DEFAULT_ALIGNMENT_CONFIG_NAME after validation."
  end
end

# Cutover + staleness for the taxonomy refresh (epic #548 refresh pipeline, cutover/rollback + alarm).
#
# Cutover is the LAST, human-gated step: it flips the default AlignmentConfig so NEW pipeline runs use
# the refreshed reference. Historical runs are untouched (each is pinned to its own alignment_config_id
# via ProjectWorkflowVersion), so cutover is instant and fully reversible -- rollback just flips the
# default back to the previous config. No data is moved or destroyed.
#
# Staleness is the reference-age alarm: run it on a schedule (a CronJob) so the observability stack
# alerts when the live reference is older than one quarter -- the SLA (mirror NCBI, never worse than a
# quarter, except the ~annual NT/NR rebuild).
#
# Usage:
#   rake 'taxonomy:cutover[2026-07-09]'                 # flip the default (prints the rollback cmd)
#   rake 'taxonomy:cutover_rollback[2024-02-06]'        # flip back to the previous config
#   rake taxonomy:staleness                             # MAX_AGE_DAYS default 92 (~1 quarter)
namespace :taxonomy do
  desc "Cut over: flip the default AlignmentConfig to a version (instant, reversible). Human-gated."
  task :cutover, [:version] => :environment do |_t, args|
    version = (args[:version] || ENV["VERSION"]).to_s.strip
    abort("taxonomy:cutover requires a version (AlignmentConfig name)") if version.empty?
    target = AlignmentConfig.find_by(name: version)
    abort("taxonomy:cutover: no AlignmentConfig named '#{version}' -- run alignment_config:register first") if target.nil?

    previous = AppConfigHelper.get_app_config(AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME)
    if previous == version
      puts "[taxonomy:cutover] default is already '#{version}'; nothing to do."
      next
    end

    puts "[taxonomy:cutover] flipping default AlignmentConfig: '#{previous}' -> '#{version}'"
    AppConfigHelper.update_default_alignment_config(version)
    puts "[taxonomy:cutover] DONE. New runs use '#{version}'; existing runs are pinned + untouched."
    puts "  Rollback (instant): rake 'taxonomy:cutover_rollback[#{previous}]'"
  end

  desc "Roll back the cutover: flip the default AlignmentConfig back to the previous version"
  task :cutover_rollback, [:previous_version] => :environment do |_t, args|
    prev = (args[:previous_version] || ENV["PREVIOUS_VERSION"]).to_s.strip
    abort("taxonomy:cutover_rollback requires the previous version to restore") if prev.empty?
    abort("taxonomy:cutover_rollback: no AlignmentConfig named '#{prev}'") if AlignmentConfig.find_by(name: prev).nil?

    current = AppConfigHelper.get_app_config(AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME)
    puts "[taxonomy:cutover_rollback] restoring default AlignmentConfig: '#{current}' -> '#{prev}'"
    AppConfigHelper.update_default_alignment_config(prev)
    puts "[taxonomy:cutover_rollback] DONE. New runs use '#{prev}' again."
  end

  desc "Reference-age alarm: fail if the live taxonomy reference is older than the staleness SLA"
  task staleness: :environment do
    max_age = (ENV["MAX_AGE_DAYS"] || "92").to_i # ~1 quarter (SLA: never worse than a quarter)
    name = AppConfigHelper.get_app_config(AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME)
    config = AlignmentConfig.find_by(name: name)
    version = config&.lineage_version.to_s

    date =
      begin
        Date.strptime(version, "%Y-%m-%d") if version.match?(/\A\d{4}-\d{2}-\d{2}\z/)
      rescue ArgumentError
        nil
      end
    if date.nil?
      warn "[taxonomy:staleness] cannot parse a date from lineage_version=#{version.inspect} (config=#{name.inspect})"
      abort("[taxonomy:staleness] UNKNOWN reference age") unless ENV["REPORT_ONLY"] == "1"
      next
    end

    age = (Date.current - date).to_i
    line = "reference '#{name}' lineage_version=#{version} is #{age} days old (SLA #{max_age})"
    if age > max_age
      # An error-level log so the LGTM/alerting stack surfaces it; non-zero exit for a CronJob probe.
      Rails.logger.error("TaxonomyStaleness: STALE -- #{line}")
      warn "[taxonomy:staleness] STALE: #{line}"
      abort("[taxonomy:staleness] STALE") unless ENV["REPORT_ONLY"] == "1"
    else
      puts "[taxonomy:staleness] OK: #{line}"
    end
  end
end

# Nightly reference-data integrity checks (platform-overhaul #741, epic #734).
#
# Reference data (taxon lineage, alignment configs) is loaded out-of-band from the app
# deploy (reference_data:refresh / the Refresh Reference Data action). A silently
# incomplete slice does NOT break a deploy or a PR run -- it corrupts pipeline output.
# The absence of one species taxid (694009, SARS-related coronavirus) from a lineage
# slice was a real production incident (platform-overhaul #528). These checks assert the
# CURRENTLY-DEPLOYED reference data is internally consistent, on a nightly cadence, so a
# bad slice is caught within 24h instead of by a confused user.
#
# What is validated:
#   1. default_alignment_config  -- the default AlignmentConfig exists, has every required
#                                    S3 path populated, and carries a non-blank lineage_version.
#   2. lineage_sentinels         -- known-real NCBI species taxids resolve in TaxonLineage
#                                    for the current lineage_version (versioned_lineages range).
#   3. es_db_consistency         -- the taxon_lineages OpenSearch index row-count tracks the DB
#                                    row-count within tolerance (skipped where ELASTICSEARCH_ON
#                                    is false, e.g. the test env).
#
# Exit contract: prints a per-check table; exits non-zero (abort) if any :error-severity
# check failed, so a CI/nightly job gates on it. :warn-severity failures (e.g. a transient
# ES read error) are surfaced but do not fail the run.
#
# Runnable two ways:
#   - CI self-test: `rake reference_data:integrity_check` against a MySQL seeded with
#     known-good data (nightly-full-regime.yml data_integrity job) -- proves the checker,
#     the versioned_lineages query, and the exit contract.
#   - Live env: the same task run inside a deployed env (mirroring how
#     refresh-reference-data.sh runs rake against the live task definition) validates the
#     REAL deployed reference data. Wiring that live invocation is the remaining part of #741.
#
# The check logic lives in the ReferenceDataIntegrity module (defined here, mirroring how
# CheckPipelineRuns is defined in pipeline_monitor.rake) so it is unit-testable directly --
# see spec/lib/tasks/reference_data_integrity_spec.rb.

module ReferenceDataIntegrity
  module_function

  # Known-real NCBI species taxids that MUST resolve in any complete lineage slice.
  # 694009 = Severe acute respiratory syndrome-related coronavirus -- the exact taxon
  # whose absence from a slice was a live incident (platform-overhaul #528). Add more
  # sentinels (one per superkingdom) as coverage of the slice widens.
  SENTINEL_TAXIDS = {
    694009 => "Severe acute respiratory syndrome-related coronavirus (species)",
  }.freeze

  # Every S3 path an AlignmentConfig must carry for a pipeline to align against it.
  # Mirrors the presence validations on the AlignmentConfig model.
  REQUIRED_S3_PATHS = %w[
    s3_nt_db_path
    s3_nt_loc_db_path
    s3_nr_db_path
    s3_nr_loc_db_path
    s3_lineage_path
    s3_accession2taxid_path
    s3_deuterostome_db_path
  ].freeze

  # A single check outcome. severity :error fails the run; :warn is surfaced only.
  Result = Struct.new(:name, :ok, :detail, :severity, keyword_init: true) do
    def failed?
      !ok && severity == :error
    end

    def status
      return "PASS" if ok
      severity == :error ? "FAIL" : "WARN"
    end
  end

  # The lineage_version the deployed default AlignmentConfig points pipelines at. This is
  # the version reference-data integrity must be judged against, exactly as
  # TaxonLineage.fetch_lineage_by_taxid derives it from the run's alignment_config.
  def current_lineage_version
    name = AlignmentConfig.default_name
    return nil if name.blank?

    AlignmentConfig.find_by(name: name)&.lineage_version
  end

  def check_default_alignment_config
    build = ->(ok, detail, severity = :error) do
      Result.new(name: "default_alignment_config", ok: ok, detail: detail, severity: severity)
    end

    name = AlignmentConfig.default_name
    return build.call(false, "AppConfig #{AppConfig::DEFAULT_ALIGNMENT_CONFIG_NAME} is unset") if name.blank?

    cfg = AlignmentConfig.find_by(name: name)
    return build.call(false, "no AlignmentConfig row named #{name.inspect}") if cfg.nil?

    missing = REQUIRED_S3_PATHS.select { |col| cfg[col].blank? }
    return build.call(false, "config #{name.inspect} missing #{missing.join(', ')}") if missing.any?
    return build.call(false, "config #{name.inspect} has a blank lineage_version") if cfg.lineage_version.blank?

    build.call(true, "#{name.inspect} complete; lineage_version=#{cfg.lineage_version}")
  end

  def check_lineage_sentinels(lineage_version)
    if lineage_version.blank?
      return [Result.new(
        name: "lineage_sentinels",
        ok: false,
        detail: "no current lineage_version available to check sentinels against",
        severity: :error,
      )]
    end

    SENTINEL_TAXIDS.map do |taxid, label|
      present = TaxonLineage.versioned_lineages([taxid], lineage_version).exists?
      Result.new(
        name: "lineage_sentinel:#{taxid}",
        ok: present,
        detail: present ? "#{taxid} (#{label}) resolves for lineage #{lineage_version}"
                        : "#{taxid} (#{label}) MISSING for lineage #{lineage_version}",
        severity: :error,
      )
    end
  end

  # Compare the DB row-count to the OpenSearch/Elasticsearch index count. A large drift
  # means the index is stale relative to the table (search will disagree with the DB).
  # Non-fatal on a read error (:warn) -- a transient ES blip should not red the nightly.
  def check_es_db_consistency(tolerance_ratio: 0.001)
    unless defined?(ELASTICSEARCH_ON) && ELASTICSEARCH_ON
      return Result.new(
        name: "es_db_consistency",
        ok: true,
        detail: "skipped (ELASTICSEARCH_ON is false in this environment)",
        severity: :warn,
      )
    end

    db_count = TaxonLineage.count
    es_count = TaxonLineage.__elasticsearch__.client.count(index: TaxonLineage.index_name)["count"].to_i
    diff = (db_count - es_count).abs
    allowed = [(db_count * tolerance_ratio).ceil, 1].max

    Result.new(
      name: "es_db_consistency",
      ok: diff <= allowed,
      detail: "db=#{db_count} es=#{es_count} diff=#{diff} allowed=#{allowed}",
      severity: :error,
    )
  rescue StandardError => e
    Result.new(
      name: "es_db_consistency",
      ok: false,
      detail: "check errored (non-fatal): #{e.class}: #{e.message}",
      severity: :warn,
    )
  end

  # Run every check, returning the flat list of Results.
  def run
    results = []
    results << check_default_alignment_config
    results.concat(check_lineage_sentinels(current_lineage_version))
    results << check_es_db_consistency
    results
  end
end

namespace :reference_data do
  desc "Validate deployed reference-data integrity (lineage sentinels, alignment_config, ES-vs-DB). Nightly #741."
  task integrity_check: :environment do
    results = ReferenceDataIntegrity.run

    puts ""
    puts "Reference-data integrity check"
    puts format("  %-6s  %-26s  %s", "STATUS", "CHECK", "DETAIL")
    results.each do |r|
      puts format("  %-6s  %-26s  %s", r.status, r.name, r.detail)
    end
    puts ""

    failures = results.select(&:failed?)
    if failures.any?
      abort("reference-data integrity FAILED: #{failures.map(&:name).join(', ')}")
    end

    warnings = results.reject(&:ok)
    puts "reference-data integrity OK#{warnings.any? ? " (with #{warnings.size} warning(s))" : ''}"
  end
end

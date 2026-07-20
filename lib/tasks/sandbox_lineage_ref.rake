# Shared taxon-lineage reference for preview sandboxes (platform-overhaul 731).
#
# THE PROBLEM: each per-PR sandbox has its own MySQL schema idseq_pr_<N> and, via the
# taxon-load PreSync Job, loads a LIGHT SLICE of the lineage that OMITS taxid 694009
# (SARS-CoV) + ~20k taxa (#528). So a sandbox pipeline e2e hits
# TaxonLineage::LineageNotFoundError. Loading the full ~3M-row lineage into every
# ephemeral sandbox schema is infeasible -- which is exactly why the slice exists.
#
# THE FIX (mirror what OpenSearch already does -- sandboxes READ dev's shared full
# taxon_lineages_alias rather than copying it): keep the full lineage in ONE persistent
# shared schema, and point each sandbox's taxon_lineages at it via a VIEW. Every sandbox
# then reads the FULL lineage with zero per-run load; per-PR isolation for mutable data
# (samples/users/runs) is unchanged.
#
# TWO TASKS:
#   build  -- ONE-TIME, elevated: create the shared schema + load the full lineage into
#             it. Run once by an operator/provisioner, supervised (it is a multi-million
#             row load). Idempotent: re-running against a populated ref schema is a no-op.
#   attach -- PER-SANDBOX, runs as the sandbox's own scoped user (the taxon-load hook):
#             replace the sandbox's local taxon_lineages TABLE with a VIEW onto the shared
#             schema. Hard-guarded so it can ONLY ever run inside an idseq_pr_<N> schema.
namespace :sandbox_lineage_ref do
  # The one persistent shared reference schema. A fixed constant (never built from user
  # input), so these tasks can only ever name this exact schema.
  REF_SCHEMA = (ENV["TAXON_LINEAGE_REF_SCHEMA"].presence || "idseq_sandbox_ref").freeze
  # Only a schema matching this may have its taxon_lineages table dropped/replaced. This
  # is the load-bearing safety guard: attach can NEVER touch idseq_dev/staging/prod.
  SANDBOX_SCHEMA_RE = /\Aidseq_pr_\d+\z/

  def self.current_schema
    ActiveRecord::Base.connection.select_value("SELECT DATABASE()").to_s
  end

  def self.table_type(schema, table)
    ActiveRecord::Base.connection.select_value(
      ActiveRecord::Base.sanitize_sql_array([
        "SELECT table_type FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
        schema, table,
      ])
    )
  end

  desc "PER-SANDBOX: point taxon_lineages at the shared full-lineage schema via a VIEW (idempotent)"
  task attach: :environment do
    schema = current_schema
    # GUARD 1: never run outside a sandbox schema. A blank/dev/staging/prod schema aborts
    # BEFORE any DDL, so this task can never drop a real taxon_lineages table.
    unless schema.match?(SANDBOX_SCHEMA_RE)
      abort("[sandbox_lineage_ref:attach] REFUSING: current schema #{schema.inspect} is not a " \
            "sandbox schema (idseq_pr_<N>). This task only runs inside a preview sandbox.")
    end
    # GUARD 2: the shared ref schema + its taxon_lineages must already exist (built once
    # via sandbox_lineage_ref:build). Fail loud rather than silently leave the sandbox
    # without lineage.
    unless table_type(REF_SCHEMA, "taxon_lineages")
      abort("[sandbox_lineage_ref:attach] REFUSING: shared reference #{REF_SCHEMA}.taxon_lineages " \
            "does not exist. Run sandbox_lineage_ref:build once first.")
    end

    existing = table_type(schema, "taxon_lineages")
    if existing == "VIEW"
      puts "[sandbox_lineage_ref:attach] #{schema}.taxon_lineages is already a VIEW onto #{REF_SCHEMA}; nothing to do."
      next
    end

    conn = ActiveRecord::Base.connection
    conn.transaction do
      # DROP the (empty, freshly-migrated) local table and replace it with a VIEW onto the
      # shared full lineage. REF_SCHEMA is a fixed constant; schema is guard-checked above.
      conn.execute("DROP TABLE IF EXISTS `taxon_lineages`")
      conn.execute("CREATE OR REPLACE VIEW `taxon_lineages` AS SELECT * FROM `#{REF_SCHEMA}`.`taxon_lineages`")
    end
    rows = conn.select_value("SELECT COUNT(*) FROM `taxon_lineages`")
    puts "[sandbox_lineage_ref:attach] #{schema}.taxon_lineages -> VIEW onto #{REF_SCHEMA} (#{rows} rows visible)."
  end

  desc "ONE-TIME (elevated): create the shared schema + taxon_lineages table structure (supervised)"
  task build: :environment do
    # Must NOT run as an ordinary sandbox -- this builds the SHARED reference, once.
    if current_schema.match?(SANDBOX_SCHEMA_RE)
      abort("[sandbox_lineage_ref:build] REFUSING: running inside a sandbox schema (#{current_schema}). " \
            "Build the shared reference from an elevated/admin context, not a sandbox.")
    end
    # Copy the taxon_lineages structure from a source schema (LIKE). Defaults to the current
    # schema's own table (e.g. run this from a context whose DB has the table). The
    # connecting user needs CREATE on REF_SCHEMA + SELECT on the source table.
    source_schema = ENV["TAXON_LINEAGE_SOURCE_SCHEMA"].presence || current_schema
    conn = ActiveRecord::Base.connection
    conn.execute("CREATE DATABASE IF NOT EXISTS `#{REF_SCHEMA}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    conn.execute("CREATE TABLE IF NOT EXISTS `#{REF_SCHEMA}`.`taxon_lineages` LIKE `#{source_schema}`.`taxon_lineages`")
    existing = conn.select_value("SELECT COUNT(*) FROM `#{REF_SCHEMA}`.`taxon_lineages`").to_i
    puts "[sandbox_lineage_ref:build] #{REF_SCHEMA}.taxon_lineages ready (structure like #{source_schema}; #{existing} rows)."
    if existing.zero?
      # The heavy load is run as its OWN process pointed at the shared schema, reusing the
      # existing gunzip-aware, chunked, reconnecting importer verbatim -- no mid-process
      # connection swap. Do it once, supervised (multi-million rows). See #731 / #528 /
      # docs/TAXON-LINEAGE-FULL-CUTOVER.md.
      puts "[sandbox_lineage_ref:build] NEXT (one-time, supervised) -- load the FULL lineage into it:"
      puts "  DB_NAME=#{REF_SCHEMA} \\"
      puts "  TAXON_LINEAGE_FILE_KEY=ncbi-indexes-prod/2024-02-06/index-generation-2/versioned-taxid-lineages.csv.gz \\"
      puts "  TAXON_LINEAGE_MIN_ROWS=<full-row-count> \\"
      puts "    rake taxon_lineage_slice:import_data_from_s3"
    end
  end
end

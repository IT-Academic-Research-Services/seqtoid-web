# frozen_string_literal: true

require "zlib"
require "fileutils"

# Service to export all data associated with a user for migration purposes.
#
# MIGRATION STRATEGY: PRESERVE IDS
# --------------------------------
# The target database seeds its AUTO_INCREMENT counters to a high initial value,
# above the highest ID being migrated. This guarantees no collisions between
# migrated rows (which keep their original IDs) and rows created in the target
# afterwards. As a result, this export is a faithful dump of each row's real
# primary key and foreign keys -- and JSON fields containing embedded IDs
# (params_json, inputs_json, data) are exported verbatim.
#
# The one value remapped on import is the user id: the user is (re)created on
# the new platform with a new id, so the exported user id (and any user_id /
# creator_id pointing at this user) is the remap source. See
# UserDataImportService for details.
#
# ON-DISK FORMAT: STREAMING NDJSON BUNDLE
# ---------------------------------------
# The export is written as a directory bundle, NOT one JSON document, so memory
# stays flat for arbitrarily large users (building the whole graph in memory for
# a mid-size user measured 6.7 GB RSS / 1.2 GB JSON and OOM-killed a 2 GB host):
#   * user.json / user_profile.json  -- single-object files (one row each).
#   * <table>.ndjson.gz              -- one gzipped NDJSON file per extracted
#                                       table below, streamed row-by-row via
#                                       find_each (one DB batch in memory at a
#                                       time; gzip compresses incrementally).
#   * manifest.json                  -- written LAST (completion marker); lists
#                                       the schema version and each table's row
#                                       count. The importer reconciles against it.
# Children the previous format nested under a parent (taxon_counts under
# pipeline_runs, etc.) are now flat per-table files linked by their preserved
# foreign keys; small join-id arrays (visualizations.sample_ids, ...) stay inline
# on the parent row. The per-record field mapping lives in the row_* builders.
#
# =============================================================================
# MIGRATION DECISIONS FOR USER DATA EXPORT
# =============================================================================
#
# EXTRACTED TABLES (User-specific data, IDs preserved):
# -----------------------------------------------------
# | Table                  | Decision       | Notes                                           |
# |------------------------|----------------|------------------------------------------------|
# | users                  | Extract        | Core entity (salt excluded for security)       |
# |                        |                | NOTE: Review fields with recipient team        |
# | user_profiles          | Extract        |                                                |
# | user_settings          | Extract        |                                                |
# | projects               | Extract        | creator_id + user associations                 |
# | samples                | Extract        | user_id, project_id, host_genome_id            |
# | input_files            | Extract        | Nested under samples                           |
# | metadata               | Extract        | Nested under samples                           |
# | pipeline_runs          | Extract        | Nested under samples                           |
# | pipeline_run_stages    | Extract        | Nested under pipeline_runs                     |
# | taxon_counts           | Extract        | Nested under pipeline_runs                     |
# | contigs                | Extract        | Nested under pipeline_runs                     |
# | job_stats              | Extract        | Nested under pipeline_runs                     |
# | ercc_counts            | Extract        | Nested under pipeline_runs                     |
# | insert_size_metric_sets| Extract        | Nested under pipeline_runs                     |
# | taxon_byteranges       | Extract        | Nested under pipeline_runs                     |
# | output_states          | Extract        | Nested under pipeline_runs                     |
# | accession_coverage_stats| Extract       | Nested under pipeline_runs                     |
# | amr_counts             | Extract        | Nested under pipeline_runs (AMR)               |
# | workflow_runs          | Extract        | sample_id, user_id                             |
# | visualizations         | Extract        | user_id, sample associations                   |
# | phylo_trees            | Extract        | Legacy; user_id, project_id, pipeline_run assoc|
# | phylo_tree_ngs         | Extract        | user_id, project_id, pipeline_run associations |
# | backgrounds            | Extract        | user_id, pipeline_run associations             |
# | taxon_summaries        | Extract        | Nested under backgrounds                       |
# | bulk_downloads         | Extract        | user_id, pipeline_run/workflow_run associations|
# | persisted_backgrounds  | Extract        | user_id, project_id, background_id             |
# | snapshot_links         | Extract        | project_id, creator_id                         |
# | project_workflow_versions| Extract      | Nested under projects                          |
#
# JOIN TABLES (handled via associated ID arrays, IDs preserved):
# --------------------------------------------------------------
# | Table                          | Handled By                                     |
# |--------------------------------|------------------------------------------------|
# | projects_users                 | projects extraction (user associations)        |
# | samples_visualizations         | visualizations extraction (sample_ids)         |
# | backgrounds_pipeline_runs      | backgrounds extraction (pipeline_run_ids)      |
# | bulk_downloads_pipeline_runs   | bulk_downloads extraction (pipeline_run_ids)   |
# | bulk_downloads_workflow_runs   | bulk_downloads extraction (workflow_run_ids)   |
# | phylo_tree_ngs_pipeline_runs   | phylo_tree_ngs extraction (pipeline_run_ids)   |
# | phylo_trees_pipeline_runs      | phylo_trees extraction (pipeline_run_ids)      |
# | metadata_fields_projects       | projects extraction                            |
#
# SKIPPED TABLES (not user-specific):
# -----------------------------------
# | Table                | Reason                                                      |
# |----------------------|-------------------------------------------------------------|
# | deletion_logs        | Not relevant post-transfer                                  |
# | nextgen_deletion_logs| Not relevant post-transfer                                  |
# | shortened_urls       | Not critical for migration                                  |
# | annotations          | TODO: Review if user-specific                               |
#
# REFERENCE DATA TABLES (shared across all users, migrate separately):
# --------------------------------------------------------------------
# These are referenced by foreign key (e.g. host_genome_id, alignment_config_id,
# metadata_field_id, location_id, taxon lineages) and are assumed to already
# exist in the target database with matching IDs. They are NOT exported here.
# | alignment_configs    | host_genomes        | app_configs         | citations         |
# | locations            | metadata_fields     | pathogen_lists      | pathogens         |
# | sample_types         | taxon_descriptions  | taxon_lineages      | workflow_versions |
#
# SYSTEM/RAILS TABLES (never migrate):
# ------------------------------------
# | ar_internal_metadata | schema_migrations | data_migrations | seed_migrations |
#
# COUNTER CACHE FIELDS (not extracted, reset after import):
# ---------------------------------------------------------
# These fields are auto-updated by Rails ActiveRecord but NOT by direct inserts.
# The import service resets them after loading. Affected:
#   users.samples_count, users.visualizations_count, users.phylo_trees_count,
#   host_genomes.samples_count
#
# DERIVED FIELDS (extracted for data fidelity):
# ---------------------------------------------
# Computed/rounded versions of other fields, extracted to ensure exact migration:
#   taxon_counts.percent_identity_decimal, taxon_counts.alignment_length_decimal,
#   taxon_counts.rpm_decimal
#
# =============================================================================
class UserDataExportService
  include Callable

  class ExportError < StandardError; end
  class UserNotFoundError < ExportError; end

  # Bundle format version. Only a forward-compatibility guard: the importer
  # refuses a bundle whose version it doesn't recognize. This feature is not yet
  # released, so we keep a single current version rather than maintaining history.
  SCHEMA_VERSION = "1.0"

  # Rows per DB fetch. Small enough that one batch of the heaviest table
  # (contigs, ~9.5 KB/row measured) stays well under ~20 MB.
  BATCH_SIZE = 2_000

  # @param user_id [Integer] user to export (or use user_email)
  # @param user_email [String]
  # @param output_dir [String] directory to write the export bundle into; the
  #   directory is created if missing and populated with <table>.ndjson.gz files,
  #   user.json, (optionally) user_profile.json and manifest.json.
  def initialize(user_id: nil, user_email: nil, output_dir: nil)
    raise ArgumentError, "Must provide either user_id or user_email" if user_id.nil? && user_email.nil?
    raise ArgumentError, "Must provide output_dir" if output_dir.blank?

    @user = if user_id
              User.find_by(id: user_id)
            else
              User.find_by(email: user_email)
            end

    identifier = user_id || user_email
    raise UserNotFoundError, "User not found: #{identifier}" unless @user

    @user_id = @user.id
    @output_dir = output_dir.to_s
    @warnings = []
    @table_counts = {}
    @files = []
  end

  # Streams the export bundle into @output_dir and returns a summary Hash:
  #   { dir:, schema_version:, user_id:, table_counts:, files:, warnings: }
  def call
    Rails.logger.info("UserDataExport: Starting streaming extraction for user #{@user_id} -> #{@output_dir}")
    FileUtils.mkdir_p(@output_dir)

    # ID lists drive the per-table streams. These are integer arrays only (a few
    # thousand entries even for large users), safe to hold in memory. Pipeline runs
    # are filtered to the migratable ones (short-read >= 7.0.0; ONT exempt) so both
    # the pipeline_runs table and its children only include migrated runs.
    sample_ids = @user.samples.pluck(:id)
    pr_ids = PipelineRun.where(sample_id: sample_ids)
                        .select(:id, :technology, :pipeline_version)
                        .select(&:migratable?)
                        .map(&:id)
    background_ids = @user.backgrounds.pluck(:id)

    write_object("user.json", extract_user)
    profile = extract_user_profile
    write_object("user_profile.json", profile) if profile

    stream_user_settings
    stream_projects
    stream_samples
    stream_input_files(sample_ids)
    stream_metadata(sample_ids)
    stream_pipeline_runs(pr_ids)
    stream_pipeline_run_children(pr_ids)
    stream_workflow_runs(sample_ids)
    stream_visualizations
    stream_phylo_trees
    stream_phylo_tree_ngs
    stream_backgrounds
    stream_taxon_summaries(background_ids)
    stream_bulk_downloads
    stream_persisted_backgrounds
    stream_snapshot_links

    write_object("manifest.json", manifest)
    Rails.logger.info("UserDataExport: Completed streaming extraction for user #{@user_id}")

    {
      dir: @output_dir,
      schema_version: SCHEMA_VERSION,
      user_id: @user_id,
      table_counts: @table_counts,
      files: @files,
      warnings: @warnings,
    }
  end

  private

  def manifest
    {
      schema_version: SCHEMA_VERSION,
      format: "ndjson-gzip",
      extracted_at: Time.current.iso8601,
      source_environment: Rails.env,
      user_id: @user_id,
      single_object_files: @files.grep(/\.json\z/),
      table_counts: @table_counts,
      warnings: @warnings,
    }
  end

  # ---- streaming infrastructure ------------------------------------------------

  # Writes a single small object as one .json file (user, user_profile, manifest).
  def write_object(filename, obj)
    path = File.join(@output_dir, filename)
    File.open(path, "w") { |f| f.write(JSON.generate(obj)) }
    @files << filename
    path
  end

  # Opens <name>.ndjson.gz and yields a writer proc; each call appends one compact
  # JSON line and is compressed + flushed incrementally so nothing accumulates.
  def stream_table(name)
    filename = "#{name}.ndjson.gz"
    path = File.join(@output_dir, filename)
    count = 0
    Zlib::GzipWriter.open(path) do |gz|
      writer = lambda do |row|
        gz.write("#{JSON.generate(row)}\n")
        count += 1
      end
      yield(writer)
    end
    @table_counts[name] = count
    @files << filename
    Rails.logger.info("UserDataExport: wrote #{count} rows -> #{filename}")
    count
  end

  # ---- single-object extractors ------------------------------------------------

  def extract_user
    {
      id: @user.id,
      email: @user.email,
      name: @user.name,
      institution: @user.institution,
      role: @user.role,
      created_at: @user.created_at&.iso8601,
      updated_at: @user.updated_at&.iso8601,
      created_by_user_id: @user.created_by_user_id,
      archetypes: @user.archetypes,
      segments: @user.segments,
      allowed_features: @user.allowed_features,
      profile_form_version: @user.profile_form_version,
      sign_in_count: @user.sign_in_count,
      current_sign_in_at: @user.current_sign_in_at&.iso8601,
      last_sign_in_at: @user.last_sign_in_at&.iso8601,
      # sign-in IP addresses (current_sign_in_ip/last_sign_in_ip) are intentionally
      # excluded: they are PII, drive no application logic, and are not exposed via
      # the API. Same rationale as excluding the password salt.
    }
  end

  def extract_user_profile
    profile = UserProfile.find_by(user_id: @user_id)
    return nil unless profile

    {
      id: profile.id,
      user_id: profile.user_id,
      first_name: profile.first_name,
      last_name: profile.last_name,
      profile_form_version: profile.profile_form_version,
      ror_institution: profile.ror_institution,
      ror_id: profile.ror_id,
      country: profile.country,
      world_bank_income: profile.world_bank_income,
      expertise_level: profile.expertise_level,
      czid_usecase: profile.czid_usecase,
      referral_source: profile.referral_source,
      newsletter_consent: profile.newsletter_consent,
      created_at: profile.created_at&.iso8601,
      updated_at: profile.updated_at&.iso8601,
    }
  end

  # ---- per-table streams -------------------------------------------------------

  def stream_user_settings
    stream_table("user_settings") do |out|
      @user.user_settings.find_each(batch_size: BATCH_SIZE) { |s| out.call(row_user_setting(s)) }
    end
  end

  def row_user_setting(setting)
    {
      id: setting.id,
      user_id: setting.user_id,
      key: setting.key,
      serialized_value: setting.serialized_value,
    }
  end

  def stream_projects
    stream_table("projects") do |out|
      Project.where(creator_id: @user_id).find_each(batch_size: BATCH_SIZE) do |project|
        out.call(row_project(project, is_owner: true))
      end
      @user.projects.where.not(creator_id: @user_id).find_each(batch_size: BATCH_SIZE) do |project|
        out.call(row_project(project, is_owner: false))
      end
    end
  end

  def row_project(project, is_owner:)
    {
      id: project.id,
      creator_id: project.creator_id,
      name: project.name,
      description: project.description,
      public_access: project.public_access,
      days_to_keep_sample_private: project.days_to_keep_sample_private,
      background_flag: project.background_flag,
      subsample_default: project.subsample_default,
      max_input_fragments_default: project.max_input_fragments_default,
      project_workflow_versions: project.project_workflow_versions.map do |v|
        { id: v.id, project_id: v.project_id, workflow: v.workflow, version_prefix: v.version_prefix }
      end,
      created_at: project.created_at&.iso8601,
      updated_at: project.updated_at&.iso8601,
      is_owner: is_owner,
    }
  end

  def stream_samples
    stream_table("samples") do |out|
      @user.samples.find_each(batch_size: BATCH_SIZE) { |sample| out.call(row_sample(sample)) }
    end
  end

  def row_sample(sample)
    {
      id: sample.id,
      user_id: sample.user_id,
      project_id: sample.project_id,
      host_genome_id: sample.host_genome_id,
      name: sample.name,
      status: sample.status,
      sample_notes: sample.sample_notes,
      s3_preload_result_path: sample.s3_preload_result_path,
      s3_star_index_path: sample.s3_star_index_path,
      s3_bowtie2_index_path: sample.s3_bowtie2_index_path,
      subsample: sample.subsample,
      pipeline_branch: sample.pipeline_branch,
      alignment_config_name: sample.alignment_config_name,
      web_commit: sample.web_commit,
      pipeline_commit: sample.pipeline_commit,
      dag_vars: sample.dag_vars,
      max_input_fragments: sample.max_input_fragments,
      client_updated_at: sample.client_updated_at&.iso8601,
      uploaded_from_basespace: sample.uploaded_from_basespace,
      upload_error: sample.upload_error,
      basespace_access_token: sample.basespace_access_token,
      do_not_process: sample.do_not_process,
      pipeline_execution_strategy: sample.pipeline_execution_strategy,
      use_taxon_whitelist: sample.use_taxon_whitelist,
      initial_workflow: sample.initial_workflow,
      deleted_at: sample.deleted_at&.iso8601,
      created_at: sample.created_at&.iso8601,
      updated_at: sample.updated_at&.iso8601,
      s3_paths: {
        input_path: sample.sample_input_s3_path,
        output_path: sample.sample_output_s3_path,
      },
    }
  end

  def stream_input_files(sample_ids)
    stream_table("input_files") do |out|
      InputFile.where(sample_id: sample_ids).find_each(batch_size: BATCH_SIZE) { |f| out.call(row_input_file(f)) }
    end
  end

  def row_input_file(input_file)
    {
      id: input_file.id,
      sample_id: input_file.sample_id,
      name: input_file.name,
      presigned_url: input_file.presigned_url,
      source: input_file.source,
      source_type: input_file.source_type,
      upload_client: input_file.upload_client,
      file_type: input_file.file_type,
      file_path: input_file.file_path,
      parts: input_file.parts,
      created_at: input_file.created_at&.iso8601,
      updated_at: input_file.updated_at&.iso8601,
    }
  end

  def stream_metadata(sample_ids)
    stream_table("metadata") do |out|
      Metadatum.where(sample_id: sample_ids).find_each(batch_size: BATCH_SIZE) { |m| out.call(row_metadatum(m)) }
    end
  end

  def row_metadatum(metadata)
    {
      id: metadata.id,
      sample_id: metadata.sample_id,
      key: metadata.key,
      raw_value: metadata.raw_value,
      string_validated_value: metadata.string_validated_value,
      number_validated_value: metadata.number_validated_value,
      date_validated_value: metadata.date_validated_value&.iso8601,
      location_id: metadata.location_id,
      metadata_field_id: metadata.metadata_field_id,
      created_at: metadata.created_at&.iso8601,
      updated_at: metadata.updated_at&.iso8601,
    }
  end

  def stream_pipeline_runs(pr_ids)
    stream_table("pipeline_runs") do |out|
      PipelineRun.where(id: pr_ids).find_each(batch_size: BATCH_SIZE) { |pr| out.call(row_pipeline_run(pr)) }
    end
  end

  def row_pipeline_run(pr)
    {
      id: pr.id,
      sample_id: pr.sample_id,
      alignment_config_id: pr.alignment_config_id,
      job_status: pr.job_status,
      finalized: pr.finalized,
      pipeline_version: pr.pipeline_version,
      wdl_version: pr.wdl_version,
      pipeline_commit: pr.pipeline_commit,
      pipeline_branch: pr.pipeline_branch,
      technology: pr.technology,
      deprecated: pr.deprecated,
      subsample: pr.subsample,
      max_input_fragments: pr.max_input_fragments,
      total_reads: pr.total_reads,
      adjusted_remaining_reads: pr.adjusted_remaining_reads,
      unmapped_reads: pr.unmapped_reads,
      mapped_reads: pr.mapped_reads,
      total_ercc_reads: pr.total_ercc_reads,
      fraction_subsampled: pr.fraction_subsampled,
      truncated: pr.truncated,
      total_bases: pr.total_bases,
      unmapped_bases: pr.unmapped_bases,
      fraction_subsampled_bases: pr.fraction_subsampled_bases,
      truncated_bases: pr.truncated_bases,
      qc_percent: pr.qc_percent,
      compression_ratio: pr.compression_ratio,
      alert_sent: pr.alert_sent,
      results_finalized: pr.results_finalized,
      time_to_finalized: pr.time_to_finalized,
      time_to_results_finalized: pr.time_to_results_finalized,
      executed_at: pr.executed_at&.iso8601,
      assembled: pr.assembled,
      s3_output_prefix: pr.s3_output_prefix,
      pipeline_execution_strategy: pr.pipeline_execution_strategy,
      sfn_execution_arn: pr.sfn_execution_arn,
      use_taxon_whitelist: pr.use_taxon_whitelist,
      dag_vars: pr.dag_vars,
      guppy_basecaller_setting: pr.guppy_basecaller_setting,
      error_message: pr.error_message,
      known_user_error: pr.known_user_error,
      deleted_at: pr.deleted_at&.iso8601,
      created_at: pr.created_at&.iso8601,
      updated_at: pr.updated_at&.iso8601,
    }
  end

  # The heavy tables, each a gzipped NDJSON stream keyed by pipeline_run_id.
  #
  # We iterate ONE pipeline_run_id at a time rather than a single
  # `where(pipeline_run_id: pr_ids)` + find_each. find_each paginates by primary
  # key (`... AND id > ? ORDER BY id LIMIT`), and because a user's rows are
  # scattered across the global id space, that makes each batch resume a scan of
  # the whole (multi-million-row) table. `where(pipeline_run_id: X)` instead is
  # served as a bounded range scan by the pipeline_run_id index (InnoDB secondary
  # indexes are ordered by the indexed column then PK, so ORDER BY id is free),
  # touching only that run's rows.
  def stream_pipeline_run_children(pr_ids)
    stream_by_pipeline_run("taxon_counts", TaxonCount, pr_ids) { |r| row_taxon_count(r) }
    stream_by_pipeline_run("job_stats", JobStat, pr_ids) { |r| row_job_stat(r) }
    stream_by_pipeline_run("contigs", Contig, pr_ids) { |r| row_contig(r) }
    stream_by_pipeline_run("ercc_counts", ErccCount, pr_ids) { |r| row_ercc_count(r) }
    stream_by_pipeline_run("annotations", Annotation, pr_ids) { |r| row_annotation(r) }
    stream_by_pipeline_run("output_states", OutputState, pr_ids) { |r| row_output_state(r) }
    stream_by_pipeline_run("insert_size_metric_sets", InsertSizeMetricSet, pr_ids) { |r| row_insert_size_metric_set(r) }
    stream_by_pipeline_run("pipeline_run_stages", PipelineRunStage, pr_ids) { |r| row_pipeline_run_stage(r) }
    stream_by_pipeline_run("taxon_byteranges", TaxonByterange, pr_ids) { |r| row_taxon_byterange(r) }
    stream_by_pipeline_run("accession_coverage_stats", AccessionCoverageStat, pr_ids) { |r| row_accession_coverage_stat(r) }
    stream_by_pipeline_run("amr_counts", AmrCount, pr_ids) { |r| row_amr_count(r) }
  end

  # Streams `model` rows for the given pipeline_run_ids into <name>.ndjson.gz, one
  # run at a time so each query uses the pipeline_run_id index (see above). The
  # block maps a record to its serialized row Hash.
  def stream_by_pipeline_run(name, model, pr_ids)
    stream_table(name) do |out|
      pr_ids.each do |pr_id|
        model.where(pipeline_run_id: pr_id).find_each(batch_size: BATCH_SIZE) { |r| out.call(yield(r)) }
      end
    end
  end

  def row_taxon_count(tc)
    {
      id: tc.id,
      pipeline_run_id: tc.pipeline_run_id,
      tax_id: tc.tax_id,
      tax_level: tc.tax_level,
      count_type: tc.count_type,
      count: tc.count,
      percent_identity: tc.percent_identity,
      percent_identity_decimal: tc.percent_identity_decimal,
      alignment_length: tc.alignment_length,
      alignment_length_decimal: tc.alignment_length_decimal,
      e_value: tc.e_value,
      rpm: tc.rpm,
      rpm_decimal: tc.rpm_decimal,
      base_count: tc.base_count,
      bpm: tc.bpm,
      genus_taxid: tc.genus_taxid,
      family_taxid: tc.family_taxid,
      superkingdom_taxid: tc.superkingdom_taxid,
      name: tc.name,
      common_name: tc.common_name,
      is_phage: tc.is_phage,
      source_count_type: tc.source_count_type,
      created_at: tc.created_at&.iso8601,
      updated_at: tc.updated_at&.iso8601,
    }
  end

  def row_job_stat(js)
    {
      id: js.id,
      pipeline_run_id: js.pipeline_run_id,
      task: js.task,
      reads_after: js.reads_after,
      bases_after: js.bases_after,
      created_at: js.created_at&.iso8601,
      updated_at: js.updated_at&.iso8601,
    }
  end

  def row_contig(contig)
    {
      id: contig.id,
      pipeline_run_id: contig.pipeline_run_id,
      name: contig.name,
      sequence: contig.sequence,
      read_count: contig.read_count,
      base_count: contig.base_count,
      lineage_json: contig.lineage_json,
      species_taxid_nt: contig.species_taxid_nt,
      species_taxid_nr: contig.species_taxid_nr,
      genus_taxid_nt: contig.genus_taxid_nt,
      genus_taxid_nr: contig.genus_taxid_nr,
      species_taxid_merged_nt_nr: contig.species_taxid_merged_nt_nr,
      genus_taxid_merged_nt_nr: contig.genus_taxid_merged_nt_nr,
      created_at: contig.created_at&.iso8601,
      updated_at: contig.updated_at&.iso8601,
    }
  end

  def row_ercc_count(ec)
    {
      id: ec.id,
      pipeline_run_id: ec.pipeline_run_id,
      name: ec.name,
      count: ec.count,
      created_at: ec.created_at&.iso8601,
      updated_at: ec.updated_at&.iso8601,
    }
  end

  def row_annotation(annotation)
    {
      id: annotation.id,
      pipeline_run_id: annotation.pipeline_run_id,
      tax_id: annotation.tax_id,
      content: annotation.content,
      creator_id: annotation.creator_id,
      created_at: annotation.created_at&.iso8601,
      updated_at: annotation.updated_at&.iso8601,
    }
  end

  def row_output_state(os)
    {
      id: os.id,
      pipeline_run_id: os.pipeline_run_id,
      output: os.output,
      state: os.state,
      created_at: os.created_at&.iso8601,
      updated_at: os.updated_at&.iso8601,
    }
  end

  def row_insert_size_metric_set(metric_set)
    {
      id: metric_set.id,
      pipeline_run_id: metric_set.pipeline_run_id,
      median: metric_set.median,
      mode: metric_set.mode,
      median_absolute_deviation: metric_set.median_absolute_deviation,
      min: metric_set.min,
      max: metric_set.max,
      mean: metric_set.mean,
      standard_deviation: metric_set.standard_deviation,
      read_pairs: metric_set.read_pairs,
      created_at: metric_set.created_at&.iso8601,
      updated_at: metric_set.updated_at&.iso8601,
    }
  end

  def row_pipeline_run_stage(stage)
    {
      id: stage.id,
      pipeline_run_id: stage.pipeline_run_id,
      step_number: stage.step_number,
      name: stage.name,
      job_type: stage.job_type,
      job_status: stage.job_status,
      db_load_status: stage.db_load_status,
      job_command: stage.job_command,
      command_stdout: stage.command_stdout,
      command_stderr: stage.command_stderr,
      command_status: stage.command_status,
      job_description: stage.job_description,
      job_log_id: stage.job_log_id,
      job_id: stage.job_id,
      job_progress_pct: stage.job_progress_pct,
      job_command_func: stage.job_command_func,
      load_db_command_func: stage.load_db_command_func,
      output_func: stage.output_func,
      failed_jobs: stage.failed_jobs,
      dag_json: stage.dag_json,
      executed_at: stage.executed_at&.iso8601,
      time_to_finalized: stage.time_to_finalized,
      created_at: stage.created_at&.iso8601,
      updated_at: stage.updated_at&.iso8601,
    }
  end

  def row_taxon_byterange(br)
    {
      id: br.id,
      pipeline_run_id: br.pipeline_run_id,
      taxid: br.taxid,
      hit_type: br.hit_type,
      first_byte: br.first_byte,
      last_byte: br.last_byte,
      created_at: br.created_at&.iso8601,
      updated_at: br.updated_at&.iso8601,
    }
  end

  def row_accession_coverage_stat(stat)
    {
      id: stat.id,
      pipeline_run_id: stat.pipeline_run_id,
      accession_id: stat.accession_id,
      accession_name: stat.accession_name,
      taxid: stat.taxid,
      num_contigs: stat.num_contigs,
      num_reads: stat.num_reads,
      score: stat.score,
      coverage_breadth: stat.coverage_breadth,
      coverage_depth: stat.coverage_depth,
      created_at: stat.created_at&.iso8601,
      updated_at: stat.updated_at&.iso8601,
    }
  end

  def row_amr_count(amr)
    {
      id: amr.id,
      pipeline_run_id: amr.pipeline_run_id,
      gene: amr.gene,
      allele: amr.allele,
      coverage: amr.coverage,
      depth: amr.depth,
      drug_family: amr.drug_family,
      annotation_gene: amr.annotation_gene,
      genbank_accession: amr.genbank_accession,
      total_reads: amr.total_reads,
      rpm: amr.rpm,
      dpm: amr.dpm,
      created_at: amr.created_at&.iso8601,
      updated_at: amr.updated_at&.iso8601,
    }
  end

  # Workflow runs owned via the user's samples OR directly by the user. distinct
  # dedupes rows matching both.
  def stream_workflow_runs(sample_ids)
    stream_table("workflow_runs") do |out|
      WorkflowRun.where(sample_id: sample_ids).or(WorkflowRun.where(user_id: @user_id))
                 .distinct.find_each(batch_size: BATCH_SIZE) { |wr| out.call(row_workflow_run(wr)) }
    end
  end

  def row_workflow_run(wr)
    {
      id: wr.id,
      sample_id: wr.sample_id,
      user_id: wr.user_id,
      workflow: wr.workflow,
      status: wr.status,
      wdl_version: wr.wdl_version,
      executed_at: wr.executed_at&.iso8601,
      deprecated: wr.deprecated,
      inputs_json: wr.inputs_json,
      cached_results: wr.cached_results,
      rerun_from: wr.rerun_from,
      sfn_execution_arn: wr.sfn_execution_arn,
      s3_output_prefix: wr.s3_output_prefix,
      time_to_finalized: wr.time_to_finalized,
      error_message: wr.error_message,
      temp_cg_coverage_viz: wr.temp_cg_coverage_viz,
      deleted_at: wr.deleted_at&.iso8601,
      created_at: wr.created_at&.iso8601,
      updated_at: wr.updated_at&.iso8601,
    }
  end

  def stream_visualizations
    stream_table("visualizations") do |out|
      @user.visualizations.includes(:samples).find_each(batch_size: BATCH_SIZE) do |viz|
        out.call({
                   id: viz.id,
                   user_id: viz.user_id,
                   name: viz.name,
                   visualization_type: viz.visualization_type,
                   data: viz.data,
                   public_access: viz.public_access,
                   status: viz.status,
                   sample_ids: viz.samples.map(&:id),
                   created_at: viz.created_at&.iso8601,
                   updated_at: viz.updated_at&.iso8601,
                 })
      end
    end
  end

  # Legacy PhyloTree (superseded by PhyloTreeNg, no longer creatable) is still
  # readable in the app, so we migrate it along with its phylo_trees_pipeline_runs join.
  def stream_phylo_trees
    stream_table("phylo_trees") do |out|
      @user.phylo_trees.includes(:pipeline_runs).find_each(batch_size: BATCH_SIZE) do |tree|
        out.call({
                   id: tree.id,
                   user_id: tree.user_id,
                   project_id: tree.project_id,
                   name: tree.name,
                   taxid: tree.taxid,
                   tax_level: tree.tax_level,
                   tax_name: tree.tax_name,
                   status: tree.status,
                   newick: tree.newick,
                   dag_version: tree.dag_version,
                   dag_json: tree.dag_json,
                   dag_branch: tree.dag_branch,
                   dag_vars: tree.dag_vars,
                   command_stdout: tree.command_stdout,
                   command_stderr: tree.command_stderr,
                   job_id: tree.job_id,
                   job_log_id: tree.job_log_id,
                   job_description: tree.job_description,
                   ncbi_metadata: tree.ncbi_metadata,
                   snp_annotations: tree.snp_annotations,
                   vcf: tree.vcf,
                   ready_at: tree.ready_at&.iso8601,
                   deleted_at: tree.deleted_at&.iso8601,
                   pipeline_run_ids: tree.pipeline_runs.map(&:id),
                   created_at: tree.created_at&.iso8601,
                   updated_at: tree.updated_at&.iso8601,
                 })
      end
    end
  end

  def stream_phylo_tree_ngs
    stream_table("phylo_tree_ngs") do |out|
      @user.phylo_tree_ngs.includes(:pipeline_runs).find_each(batch_size: BATCH_SIZE) do |tree|
        out.call({
                   id: tree.id,
                   user_id: tree.user_id,
                   project_id: tree.project_id,
                   name: tree.name,
                   status: tree.status,
                   tax_id: tree.tax_id,
                   inputs_json: tree.inputs_json,
                   sfn_execution_arn: tree.sfn_execution_arn,
                   s3_output_prefix: tree.s3_output_prefix,
                   wdl_version: tree.wdl_version,
                   rerun_from: tree.rerun_from,
                   executed_at: tree.executed_at&.iso8601,
                   deprecated: tree.deprecated,
                   deleted_at: tree.deleted_at&.iso8601,
                   pipeline_run_ids: tree.pipeline_runs.map(&:id),
                   created_at: tree.created_at&.iso8601,
                   updated_at: tree.updated_at&.iso8601,
                 })
      end
    end
  end

  def stream_backgrounds
    stream_table("backgrounds") do |out|
      @user.backgrounds.includes(:pipeline_runs).find_each(batch_size: BATCH_SIZE) do |bg|
        out.call({
                   id: bg.id,
                   user_id: bg.user_id,
                   name: bg.name,
                   description: bg.description,
                   public_access: bg.public_access,
                   ready: bg.ready,
                   mass_normalized: bg.mass_normalized,
                   pipeline_run_ids: bg.pipeline_runs.map(&:id),
                   created_at: bg.created_at&.iso8601,
                   updated_at: bg.updated_at&.iso8601,
                 })
      end
    end
  end

  def stream_taxon_summaries(background_ids)
    # One background_id at a time so each query uses the background_id index,
    # for the same reason as stream_by_pipeline_run.
    stream_table("taxon_summaries") do |out|
      background_ids.each do |bg_id|
        TaxonSummary.where(background_id: bg_id).find_each(batch_size: BATCH_SIZE) { |ts| out.call(row_taxon_summary(ts)) }
      end
    end
  end

  def row_taxon_summary(ts)
    {
      id: ts.id,
      background_id: ts.background_id,
      tax_id: ts.tax_id,
      tax_level: ts.tax_level,
      count_type: ts.count_type,
      mean: ts.mean,
      stdev: ts.stdev,
      rpm_list: ts.rpm_list,
      mean_mass_normalized: ts.mean_mass_normalized,
      stdev_mass_normalized: ts.stdev_mass_normalized,
      rel_abundance_list_mass_normalized: ts.rel_abundance_list_mass_normalized,
      created_at: ts.created_at&.iso8601,
      updated_at: ts.updated_at&.iso8601,
    }
  end

  def stream_bulk_downloads
    stream_table("bulk_downloads") do |out|
      @user.bulk_downloads.includes(:pipeline_runs, :workflow_runs).find_each(batch_size: BATCH_SIZE) do |bd|
        out.call({
                   id: bd.id,
                   user_id: bd.user_id,
                   download_type: bd.download_type,
                   status: bd.status,
                   error_message: bd.error_message,
                   description: bd.description,
                   params_json: bd.params_json,
                   access_token: bd.access_token,
                   progress: bd.progress,
                   ecs_task_arn: bd.ecs_task_arn,
                   output_file_size: bd.output_file_size,
                   deleted_at: bd.deleted_at&.iso8601,
                   pipeline_run_ids: bd.pipeline_runs.map(&:id),
                   workflow_run_ids: bd.workflow_runs.map(&:id),
                   created_at: bd.created_at&.iso8601,
                   updated_at: bd.updated_at&.iso8601,
                 })
      end
    end
  end

  def stream_persisted_backgrounds
    stream_table("persisted_backgrounds") do |out|
      @user.persisted_backgrounds.find_each(batch_size: BATCH_SIZE) do |pb|
        out.call({
                   id: pb.id,
                   user_id: pb.user_id,
                   project_id: pb.project_id,
                   background_id: pb.background_id,
                   created_at: pb.created_at&.iso8601,
                   updated_at: pb.updated_at&.iso8601,
                 })
      end
    end
  end

  def stream_snapshot_links
    stream_table("snapshot_links") do |out|
      SnapshotLink.where(creator_id: @user_id).find_each(batch_size: BATCH_SIZE) do |sl|
        out.call({
                   id: sl.id,
                   project_id: sl.project_id,
                   creator_id: sl.creator_id,
                   share_id: sl.share_id,
                   content: sl.content,
                   created_at: sl.created_at&.iso8601,
                   updated_at: sl.updated_at&.iso8601,
                 })
      end
    end
  end
end

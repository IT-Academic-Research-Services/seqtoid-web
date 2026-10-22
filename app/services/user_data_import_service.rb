# frozen_string_literal: true

require "zlib"

# Service to import user data from a streaming NDJSON export bundle (schema 2.0)
# into the database. Counterpart to UserDataExportService.
#
# MIGRATION STRATEGY: PRESERVE IDS, REMAP THE USER + REFERENCE FKS
# ---------------------------------------------------------------
# The target database seeds its AUTO_INCREMENT counters above the highest ID
# being migrated, so migrated rows keep their original primary keys without
# colliding with rows created in the target afterwards.
#
# REFERENCE FKS: the four id-referenced reference tables ride in the bundle and
# are matched by NATURAL KEY on the target, then samples.host_genome_id /
# pipeline_runs.alignment_config_id / metadata.metadata_field_id + location_id are
# rewritten to the target's ids. The target's own reference rows/ids are never
# altered (no destructive REPLACE INTO). Per table:
#   * host_genomes, alignment_configs -- must PRE-EXIST (created by db/data
#     migrations); matched by name, import fails loudly listing any missing ones.
#   * metadata_fields -- created if absent (core and custom alike), matched by
#     name; an existing name is reused as-is. No sample metadata is dropped.
#   * locations -- find_or_created by composite natural key (dynamic data).
#
# The ONE exception is the user itself: the user is (re)created on the new
# platform and therefore gets a NEW id. Every column that points at the
# migrated user (user_id everywhere, and creator_id where it equals the
# migrated user) is remapped from the old user id to the new one. All other
# primary keys, foreign keys, and embedded JSON IDs are used verbatim.
#
# Columns referencing OTHER users (e.g. a member project's creator_id, or
# created_by_user_id) are left as exported -- those users are outside this
# single-user migration. A warning is recorded where this may dangle.
#
# =============================================================================
# INPUT FORMAT (schema 1.0)
# =============================================================================
# The importer reads a directory produced by UserDataExportService:
#   * manifest.json          -- schema version, source metadata, per-table counts
#   * user.json              -- the migrated user (single object)
#   * user_profile.json      -- optional single object
#   * <table>.ndjson.gz      -- one gzipped NDJSON file per table
#
# Each NDJSON file is read line-by-line and inserted in batches, so only one
# batch is in memory at a time (flat RSS regardless of user size).
#
# HIGH-VOLUME tables (samples, pipeline_runs and their children, ...) are written
# with insert_all! in batches of INSERT_BATCH rows -- far fewer round-trips than
# the old row-by-row save!. Attribute type casting (enums, serialize coders, JSON
# columns) is still applied by insert_all! via the model's attribute types.
#
# LOW-VOLUME tables that need join-table rebuilds or membership handling
# (projects, visualizations, phylo_trees, phylo_tree_ngs, backgrounds,
# bulk_downloads) are inserted one row at a time with save!(validate: false) so
# their associations can be rebuilt from the preserved-id arrays inline.
#
# OPTIONS:
#   target_user_id: import into this existing user (default mode).
#   create_user:    create a new user from the export instead.
#   skip_existing:  skip rows whose primary key already exists (idempotent re-run / resume).
#   dry_run:        validate only -- runs every pre-write check (bundle shape, manifest counts,
#                   reference rows present on the target, duplicate user, primary-key collisions)
#                   READ-ONLY and writes nothing. (It used to perform the whole import inside one
#                   transaction and roll it back, holding locks for hours for no lasting effect.)
#   single_transaction: legacy all-or-nothing mode (one transaction for the whole user). Default false.
#
# TRANSACTIONS (2026-10-20): a live import no longer runs as ONE transaction for the whole user. That
# transaction held row locks on shared reference rows (host_genomes: Human/Bat/Unknown) and a metadata
# lock on every table it touched for hours, so app writes to those rows (every new sample bumps its
# host genome's counter) timed out and uploads failed, and a release's ALTER TABLE could not run.
# Now: every check that can fail runs read-only BEFORE anything is written (#validate_before_write!);
# high-volume tables commit per INSERT_BATCH statement and low-volume phases each commit in their own
# short transaction. A mid-import database error leaves a partial import that `skip_existing` resumes.
# The import also yields to the app: short lock waits with retry/backoff, and only one import runs at a
# time (a MySQL named lock).
#
# USAGE:
#   result = UserDataImportService.call(input_dir: "/mnt/.../user_123_export_...", target_user_id: 42)
#   puts result[:stats]
# =============================================================================
class UserDataImportService
  include Callable

  class ImportError < StandardError; end
  class ValidationError < ImportError; end
  class DuplicateUserError < ImportError; end
  # An imported primary key exists on the target as a DIFFERENT record (see partition_existing). Not
  # retryable with skip_existing: it needs a person to look.
  class IdConflictError < ImportError; end

  # Must match UserDataExportService::SCHEMA_VERSION. Forward-compatibility guard
  # only; the feature is unreleased so there is a single current version.
  SUPPORTED_SCHEMA_VERSION = "2.0"

  # Rows per insert_all! statement. Small enough to keep a contigs batch (with
  # LONGTEXT sequences) well under max_allowed_packet, large enough to make the
  # per-round-trip overhead negligible.
  INSERT_BATCH = 1_000

  # Next-prod mode (bulk backfill into the replica cluster, see the CZI backfill runbook). All three are
  # environment knobs so the import Job sets them and a default deploy behaves exactly as before:
  #   IMPORT_REQUIRE_DB_HOST  refuse to run unless connected to this database host. Set on the replica's
  #                           import Jobs, and on prod during the backfill window, so an import pointed at
  #                           the live database by mistake stops before reading or writing anything.
  #   IMPORT_LOCK_SCOPE       "global" (default): one import at a time. "export": one per export bundle, so
  #                           a queue runner can run several exports in parallel.
  #   IMPORT_INSERT_BATCH     rows per insert_all! statement (default INSERT_BATCH).
  REQUIRE_DB_HOST_ENV = "IMPORT_REQUIRE_DB_HOST"
  LOCK_SCOPES = %w[global export].freeze

  def initialize(input_dir:, dry_run: false, target_user_id: nil, skip_existing: false, create_user: false,
                 source_bucket: nil, dest_bucket: nil, single_transaction: false)
    @input_dir = input_dir.to_s
    @dry_run = dry_run
    @single_transaction = single_transaction
    @target_user_id = target_user_id
    @skip_existing = skip_existing
    @create_user = create_user

    # Stored full-URI columns (s3_output_prefix on pipeline_runs/workflow_runs/
    # phylo_tree_ngs, and input_files.source) bake in the source samples bucket.
    # When migrating to a partner bucket with a different name, rewrite
    # `s3://<source_bucket>/...` -> `s3://<dest_bucket>/...` as rows insert. Only
    # URIs in the source samples bucket are touched, so shared reference paths
    # (host-genome indexes, alignment DBs in *-public-references) are left alone,
    # as are derived paths (Sample#sample_*_s3_path), which are not stored and
    # recompute from the partner's SAMPLES_BUCKET_NAME.
    @source_bucket = source_bucket.presence
    @dest_bucket = dest_bucket.presence
    @rewrite_s3_bucket = @source_bucket.present? && @dest_bucket.present? && @source_bucket != @dest_bucket
    @source_uri_prefix = "s3://#{@source_bucket}/" if @rewrite_s3_bucket

    @new_user_id = nil
    @old_user_id = nil
    @insert_batch = Integer(ENV.fetch("IMPORT_INSERT_BATCH", INSERT_BATCH.to_s))
    @lock_scope = ENV.fetch("IMPORT_LOCK_SCOPE", "global")
    raise ArgumentError, "IMPORT_LOCK_SCOPE must be one of #{LOCK_SCOPES.join(', ')}" unless LOCK_SCOPES.include?(@lock_scope)

    @warnings = []
    @stats = Hash.new(0)
    # Count of created_at/updated_at values fabricated at import time (see #ts).
    @timestamps_defaulted = 0
    # Cumulative insert wall time (seconds) per table, for performance profiling
    # of large imports (taxon_counts / contigs dominate).
    @timings = Hash.new(0.0)
  end

  def call
    check_target_db_host!
    validate_bundle!
    # Every check that can fail runs here, read-only, before anything is written -- so a bad bundle never
    # leaves a partial import even though writes are no longer one transaction.
    validate_before_write!

    if @dry_run
      Rails.logger.info("UserDataImport: DRY RUN - validated read-only, nothing written")
    else
      with_import_lock do
        if @single_transaction
          # Legacy all-or-nothing mode. READ COMMITTED; ignore this inner transaction if there is an
          # outer one already (RSpec).
          ActiveRecord::Base.transaction(isolation: ActiveRecord::Base.connection.transaction_open? ? nil : :read_committed) do
            run_import_phases
            reconcile_counts!
          end
        else
          yield_locks_to_app!
          run_import_phases
          # The pre-write check already proved the files match the manifest; this catches a row the
          # import itself dropped. Data written so far stays; `skip_existing` resumes.
          reconcile_counts!
        end
      end
      reset_counter_caches
    end

    if @timestamps_defaulted.positive?
      @warnings << "Defaulted #{@timestamps_defaulted} missing created_at/updated_at value(s) to import time."
    end

    {
      success: true,
      dry_run: @dry_run,
      stats: @stats,
      timings: @timings,
      warnings: @warnings,
      old_user_id: @old_user_id,
      user_id: @new_user_id,
    }
  rescue ImportError => e
    {
      success: false,
      error: e.message,
      error_class: e.class.name,
      stats: @stats,
      warnings: @warnings,
    }
  end

  private

  # Phases in dependency order. Low-volume phases each run in their own short transaction (unless the
  # whole import is one legacy transaction); high-volume streams commit per insert_all! batch.
  LOW_VOLUME_PHASES = [
    :import_user, :import_user_profile, :stream_user_settings, :import_projects, :import_reference_tables,
    :import_metadata_field_associations,
  ].freeze
  HIGH_VOLUME_PHASES = [
    :stream_samples, :stream_input_files, :stream_metadata, :stream_pipeline_runs,
    :stream_pipeline_run_children, :stream_workflow_runs,
  ].freeze
  LATE_LOW_VOLUME_PHASES = [:import_visualizations, :import_phylo_trees, :import_phylo_tree_ngs, :import_backgrounds].freeze
  LATE_PHASES = [:stream_taxon_summaries, :import_bulk_downloads, :stream_persisted_backgrounds, :stream_snapshot_links].freeze

  def run_import_phases
    LOW_VOLUME_PHASES.each { |phase| run_phase(phase, own_transaction: true) }
    HIGH_VOLUME_PHASES.each { |phase| run_phase(phase, own_transaction: false) }
    LATE_LOW_VOLUME_PHASES.each { |phase| run_phase(phase, own_transaction: true) }
    LATE_PHASES.each { |phase| run_phase(phase, own_transaction: false) }
  end

  def run_phase(phase, own_transaction:)
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    if own_transaction && !@single_transaction
      ActiveRecord::Base.transaction(isolation: ActiveRecord::Base.connection.transaction_open? ? nil : :read_committed) { send(phase) }
    else
      send(phase)
    end
    Rails.logger.info("UserDataImport: #{phase} done in #{(Process.clock_gettime(Process::CLOCK_MONOTONIC) - started).round(1)}s")
  rescue StandardError => e
    raise if @single_transaction

    if e.is_a?(IdConflictError)
      Rails.logger.error("UserDataImport: #{phase} stopped on an id conflict; rows committed so far stay -- resolve the conflict before re-running")
      raise
    end

    Rails.logger.error(
      "UserDataImport: #{phase} failed (#{e.class}); rows committed so far stay -- re-run the same import " \
      "with mode skip_existing to resume"
    )
    raise
  end

  # Validates the shape of the import request, NOT the correctness of the record
  # data itself. We check: the bundle exists with a manifest + user.json, the
  # schema version is one we understand, and a destination user is specified.
  #
  # We intentionally do NOT run ActiveRecord model validations on imported records
  # (inserts skip validation). The goal is a faithful copy of the source data, and
  # validations can drift ahead of existing rows, so validating here would reject
  # legitimate historical data that already lives in the source DB.
  def validate_bundle!
    raise ValidationError, "Input directory not found: #{@input_dir}" unless Dir.exist?(@input_dir)

    @manifest = read_object("manifest.json")
    raise ValidationError, "Missing manifest.json" unless @manifest

    schema_version = @manifest[:schema_version]
    unless schema_version == SUPPORTED_SCHEMA_VERSION
      raise ValidationError, "Unsupported schema version: #{schema_version.inspect} (expected #{SUPPORTED_SCHEMA_VERSION})"
    end

    @user_data = read_object("user.json")
    raise ValidationError, "Missing user.json" unless @user_data

    @old_user_id = @user_data[:id]

    unless @target_user_id || @create_user
      raise ValidationError, "Must provide target_user_id to import into an existing user, or set create_user: true to create one"
    end

    if @target_user_id && !User.exists?(@target_user_id)
      raise ValidationError, "Target user not found: #{@target_user_id}"
    end

    # Per-table row counts the manifest declares (symbol keys via symbolize_names).
    # Reconciled against actual inserts after streaming (see reconcile_counts!).
    @expected_counts = @manifest[:table_counts] || {}

    # Fail fast if a table the manifest says has rows is missing its file. A
    # partially copied/uploaded bundle must not import "successfully" while
    # silently dropping an entire table.
    missing = @expected_counts.select { |_table, count| count.to_i.positive? }
                              .keys
                              .reject { |table| File.exist?(File.join(@input_dir, "#{table}.ndjson.gz")) }
    raise ValidationError, "Bundle is missing table files (incomplete copy?): #{missing.join(', ')}" if missing.any?

    (@manifest[:single_object_files] || []).each do |filename|
      raise ValidationError, "Bundle is missing #{filename}" unless File.exist?(File.join(@input_dir, filename.to_s))
    end
  end

  # Verifies every table imported (inserted + skipped) as many rows as the
  # manifest declared. A shortfall means a table file was missing or truncated;
  # we raise so the transaction rolls back instead of committing a partial import.
  def reconcile_counts!
    mismatches = @expected_counts.filter_map do |table, expected|
      actual = @stats[table.to_sym] + @stats[:"#{table}_skipped"]
      "#{table}: manifest=#{expected} imported=#{actual}" if actual != expected.to_i
    end
    return if mismatches.empty?

    raise ImportError, "Row count mismatch (incomplete bundle?): #{mismatches.join('; ')}"
  end

  # ===========================================================================
  # READERS
  # ===========================================================================

  # Reads a single-object .json file (user.json, user_profile.json, manifest.json).
  def read_object(filename)
    path = File.join(@input_dir, filename)
    return nil unless File.exist?(path)

    JSON.parse(File.read(path), symbolize_names: true)
  end

  # Yields each row (Hash) of a gzipped NDJSON file. No-op if the file is absent.
  def each_row(name)
    path = File.join(@input_dir, "#{name}.ndjson.gz")
    return unless File.exist?(path)

    Zlib::GzipReader.open(path) do |gz|
      gz.each_line do |line|
        line = line.strip
        yield(JSON.parse(line, symbolize_names: true)) unless line.empty?
      end
    end
  end

  # Number of rows (non-blank lines) in a table file, without parsing them. 0 if the file is absent.
  def count_rows(name)
    path = File.join(@input_dir, "#{name}.ndjson.gz")
    return 0 unless File.exist?(path)

    count = 0
    Zlib::GzipReader.open(path) { |gz| gz.each_line { |line| count += 1 if line.match?(/\S/) } }
    count
  end

  # Streams a gzipped NDJSON file and inserts it in INSERT_BATCH-sized batches.
  # The block maps a parsed row Hash to the DB attribute Hash for `model`.
  def stream_insert(name, model, stat_key = nil)
    stat_key ||= name.to_sym
    buffer = []
    each_row(name) do |row|
      attrs = yield(row)
      next if attrs.nil? # block returned nil -> filter this row out (not buffered/inserted)

      buffer << attrs
      if buffer.size >= @insert_batch
        flush_insert(model, stat_key, buffer)
        buffer = []
      end
    end
    flush_insert(model, stat_key, buffer)
  end

  def flush_insert(model, stat_key, rows)
    return if rows.empty?

    rows = partition_existing(model, stat_key, rows) if @skip_existing
    return if rows.empty?

    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    # rubocop:disable Rails/SkipsModelValidations -- intentional: the import is a
    # faithful copy of already-persisted source rows; validations may have drifted
    # ahead of historical data (same rationale as save!(validate: false)).
    with_lock_retry { model.insert_all!(rows) }
    # rubocop:enable Rails/SkipsModelValidations
    @timings[stat_key] += Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
    @stats[stat_key] += rows.size
  end

  # skip_existing may skip a row only when the row already on the target is the SAME record from an earlier
  # run of this export (a resume): same id AND the same parent references -- every *_id column the import
  # writes (project, sample, pipeline run, user, background, ...). The same id under different parents is a
  # different record: ids cannot be renumbered (S3 keys and every cross-reference embed them), so the import
  # stops and reports it instead of silently dropping CZI data. Returns the rows still to insert.
  def partition_existing(model, stat_key, rows)
    ids = rows.filter_map { |r| r[:id] }
    return rows if ids.empty?

    cols = identity_columns(model, rows.first)
    existing = model.where(id: ids).pluck(:id, *cols).to_h { |id, *vals| [id, vals] }
    return rows if existing.empty?

    conflicts = rows.select { |r| existing.key?(r[:id]) && !same_identity?(existing[r[:id]], cols, r) }
    raise_id_conflicts!(model, cols, conflicts, existing) if conflicts.any?

    @stats[:"#{stat_key}_skipped"] += rows.count { |r| existing.key?(r[:id]) }
    rows.reject { |r| existing.key?(r[:id]) }
  end

  def identity_columns(model, row)
    row.keys.map(&:to_s).select { |k| k.end_with?("_id") && model.column_names.include?(k) }.map(&:to_sym)
  end

  def same_identity?(found_values, cols, row)
    found_values.map(&:to_s) == cols.map { |c| row[c].to_s }
  end

  def raise_id_conflicts!(model, cols, conflicts, existing)
    @stats[:"#{model.table_name}_id_conflicts"] += conflicts.size
    detail = conflicts.first(5).map do |r|
      "id #{r[:id]}: target #{cols.zip(existing[r[:id]]).to_h} vs export #{cols.index_with { |c| r[c] }}"
    end
    raise IdConflictError, "Id conflict in #{model.table_name}: #{conflicts.size} row(s) in this batch already exist on the " \
                           "target as a DIFFERENT record (#{detail.join('; ')}). Not skipped; resolve before re-running."
  end

  # Insert a single low-volume record (returns the persisted instance so callers
  # can rebuild associations). Idempotent under skip_existing.
  def insert_one(model, stat_key, attributes)
    id = attributes[:id]
    if @skip_existing && id && (existing = model.find_by(id: id))
      cols = identity_columns(model, attributes)
      found = cols.map { |c| existing[c] }
      raise_id_conflicts!(model, cols, [attributes], { id => found }) unless same_identity?(found, cols, attributes)
      @stats[:"#{stat_key}_skipped"] += 1
      return existing
    end

    record = model.new(attributes)
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    record.save!(validate: false)
    @timings[stat_key] += Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
    @stats[stat_key] += 1
    record
  end

  # projects, backgrounds and phylo_trees names are unique platform-wide (case-insensitive). When an
  # imported row's name is already used by a DIFFERENT row on the target -- the user (or anyone) created it
  # on the platform before this export arrived, or another migrated user owns it -- the imported row is
  # renamed "<name> (CZID)", then "<name> (CZID_2)", "<name> (CZID_3)", ... instead of failing the import.
  # Nothing is merged or dropped. Each rename is counted in @stats[:<stat_key>_renamed] and listed in
  # @warnings so support can tell the user. A row whose id already exists (a skip_existing re-run) keeps the name it has.
  RENAME_SUFFIX = "CZID"
  NAME_MAX_LENGTH = 255
  NAME_UNIQUE_TABLES = { "projects" => "Project", "backgrounds" => "Background", "phylo_trees" => "PhyloTree" }.freeze

  def import_name(model, stat_key, id, name)
    return name if name.blank?
    return name if id && model.exists?(id)
    return name unless name_taken?(model, name, id)

    candidate = (1..).lazy.map { |n| renamed(name, n) }.find { |c| !name_taken?(model, c, id) }
    @stats[:"#{stat_key}_renamed"] += 1
    @warnings << "#{model.name} '#{name}' (id: #{id}) renamed to '#{candidate}': that name is already used on this platform"
    candidate
  end

  def renamed(name, attempt)
    suffix = attempt == 1 ? " (#{RENAME_SUFFIX})" : " (#{RENAME_SUFFIX}_#{attempt})"
    "#{name[0, NAME_MAX_LENGTH - suffix.length]}#{suffix}"
  end

  def name_taken?(model, name, id)
    scope = model.where("LOWER(#{model.table_name}.name) = ?", name.downcase)
    scope = scope.where.not(id: id) if id
    scope.exists?
  end

  # ===========================================================================
  # USER IMPORT
  # ===========================================================================

  def import_user
    # Default: import into an existing (platform-created) user.
    if @target_user_id
      @new_user_id = @target_user_id
      Rails.logger.info("UserDataImport: Importing into existing user #{@new_user_id}")
      return
    end

    # Otherwise create a new user (create_user: true, enforced by validate_bundle!).
    existing = User.find_by(email: @user_data[:email])
    if existing
      if @skip_existing
        @new_user_id = existing.id
        @stats[:users_skipped] += 1
        Rails.logger.info("UserDataImport: User #{@user_data[:email]} already exists, reusing id #{existing.id}")
        return
      end

      raise DuplicateUserError, "User with email #{@user_data[:email]} already exists (ID: #{existing.id})"
    end

    # Create the user with a NEW id (the platform's auto-increment). The old id
    # (@user_data[:id]) is the remap source, not preserved.
    user = User.new(
      email: @user_data[:email],
      name: @user_data[:name],
      institution: @user_data[:institution],
      role: @user_data[:role],
      created_by_user_id: @user_data[:created_by_user_id], # references another user; left as-is
      archetypes: @user_data[:archetypes],
      segments: @user_data[:segments],
      allowed_features: @user_data[:allowed_features],
      profile_form_version: @user_data[:profile_form_version],
      sign_in_count: @user_data[:sign_in_count],
      current_sign_in_at: parse_time(@user_data[:current_sign_in_at]),
      last_sign_in_at: parse_time(@user_data[:last_sign_in_at]),
      # sign-in IP addresses are intentionally not exported/imported (PII, unused).
      created_at: ts(@user_data[:created_at]),
      updated_at: ts(@user_data[:updated_at])
    )

    user.save!(validate: false) # Skip validation to preserve original data
    @new_user_id = user.id
    @stats[:users] += 1

    Rails.logger.info("UserDataImport: Created user #{user.email} (old id: #{@old_user_id} -> new id: #{@new_user_id})")
  end

  def import_user_profile
    profile = read_object("user_profile.json")
    return unless profile

    insert_one(UserProfile, :user_profiles, {
                 id: profile[:id],
                 user_id: map_user_id(profile[:user_id]),
                 first_name: profile[:first_name],
                 last_name: profile[:last_name],
                 profile_form_version: profile[:profile_form_version],
                 ror_institution: profile[:ror_institution],
                 ror_id: profile[:ror_id],
                 country: profile[:country],
                 world_bank_income: profile[:world_bank_income],
                 expertise_level: profile[:expertise_level],
                 czid_usecase: profile[:czid_usecase],
                 referral_source: profile[:referral_source],
                 newsletter_consent: profile[:newsletter_consent],
                 created_at: ts(profile[:created_at]),
                 updated_at: ts(profile[:updated_at]),
               })
  end

  def stream_user_settings
    stream_insert("user_settings", UserSetting) do |row|
      {
        id: row[:id],
        user_id: map_user_id(row[:user_id]),
        key: row[:key],
        serialized_value: row[:serialized_value],
      }
    end
  end

  # ===========================================================================
  # PROJECT IMPORT (low volume; membership + inline project_workflow_versions)
  # ===========================================================================

  def import_projects
    each_row("projects") do |row|
      # ID-PRESERVED, never remapped: S3 keys embed project_id and the transfer keeps
      # keys, so a new/remapped id would orphan every transferred object.
      # Ownership (trickle, any order): creator_id is set only by the true owner
      # (is_owner); a member arriving first creates it owner-less (nil is valid --
      # belongs_to :creator is optional), never falsely owning it. Membership is
      # granted unless the row is referenced-only (membership: false) -- a project
      # merely FK-referenced by the user's data, where the user had no access on
      # source. Old bundles lack the key (nil), so only explicit false skips it.
      grant_membership = row[:membership] != false
      if Project.exists?(row[:id])
        project = Project.find(row[:id])
        add_user_as_member(project) if grant_membership
        # Only the true owner claims ownership (an earlier member left it nil).
        project.update_columns(creator_id: @new_user_id) if row[:is_owner] # rubocop:disable Rails/SkipsModelValidations
        @stats[:projects_skipped] += 1
        @warnings << "Project '#{row[:name]}' (id: #{row[:id]}) already present" \
                     "#{grant_membership ? '; added user as member' : ''}#{row[:is_owner] ? ' and set as creator' : ''}"
        next
      end

      project = insert_one(Project, :projects, {
                             id: row[:id],
                             # Strip latent trailing/leading whitespace from source data (also version_prefix below).
                             name: import_name(Project, :projects, row[:id], row[:name]&.strip),
                             description: row[:description],
                             # Owner only; a member creates it owner-less (see above).
                             creator_id: row[:is_owner] ? @new_user_id : nil,
                             public_access: row[:public_access],
                             days_to_keep_sample_private: row[:days_to_keep_sample_private],
                             background_flag: row[:background_flag],
                             subsample_default: row[:subsample_default],
                             max_input_fragments_default: row[:max_input_fragments_default],
                             created_at: ts(row[:created_at]),
                             updated_at: ts(row[:updated_at]),
                           })

      add_user_as_member(project) if grant_membership

      (row[:project_workflow_versions] || []).each do |pwv|
        insert_one(ProjectWorkflowVersion, :project_workflow_versions, {
                     id: pwv[:id],
                     project_id: pwv[:project_id],
                     workflow: pwv[:workflow],
                     version_prefix: pwv[:version_prefix]&.strip,
                   })
      end

      Rails.logger.info("UserDataImport: Imported project '#{project.name}' (id: #{project.id})")
    end
  end

  def add_user_as_member(project)
    user = User.find(@new_user_id)
    user.projects << project unless user.projects.include?(project)
  end

  # ===========================================================================
  # REFERENCE TABLES (id-remapped by natural key; non-destructive)
  # ===========================================================================

  # find_or_creates each bundled reference row by natural key and records
  # {source_id => target_id} so the FK columns can be rewritten. The partner's
  # existing reference rows/ids are reused untouched; only truly-missing rows are
  # created (from the exported row).
  def import_reference_tables
    # Created by db/data migrations on every instance -- a missing one by name is
    # operator error, so map to the target's row and fail loudly if absent.
    @host_genome_id_map = map_existing_reference("host_genomes", HostGenome)
    @alignment_config_id_map = map_existing_reference("alignment_configs", AlignmentConfig)

    # Core AND custom fields are created if absent, matched by name, so no sample
    # metadata is ever dropped. An existing name is reused as-is (its base_type/
    # options win); only truly-absent fields are created from the exported row.
    @metadata_field_id_map = {}
    each_row("metadata_fields") do |row|
      rec = find_or_create_ref(MetadataField, { name: row[:name] }, :metadata_fields) { metadata_field_attrs(row) }
      @metadata_field_id_map[row[:id]] = rec.id
    end

    # Locations created here start with the source geo-hierarchy FKs
    # (country/state/subdivision/city_id) copied verbatim; those source ids are
    # rewritten to target ids in a second pass once the full id map exists. Reused
    # target rows already carry correct local FKs and are left untouched.
    @location_id_map = {}
    created_location_source_ids = []
    each_row("locations") do |row|
      existing = Location.find_by(location_natural_key(row))
      if existing
        @stats[:locations_skipped] += 1
        @location_id_map[row[:id]] = existing.id
      else
        rec = Location.new(location_attrs(row).compact)
        rec.save!(validate: false)
        @stats[:locations] += 1
        @location_id_map[row[:id]] = rec.id
        created_location_source_ids << row[:id]
      end
    end
    remap_location_hierarchy(created_location_source_ids)
  end

  # Rewrites the geo-hierarchy FKs on locations we created from source ids to the
  # target ids (via @location_id_map). Runs after the whole map is built so a child
  # created before its parent still resolves. A parent absent from the bundle maps to
  # nil (the FK is nulled rather than left dangling at a meaningless source id).
  def remap_location_hierarchy(created_source_ids)
    created_source_ids.each do |source_id|
      location = Location.find(@location_id_map[source_id])
      updates = {}
      [:country_id, :state_id, :subdivision_id, :city_id].each do |col|
        source_fk = location[col]
        updates[col] = @location_id_map[source_fk] if source_fk.present?
      end
      # rubocop:disable Rails/SkipsModelValidations
      location.update_columns(updates) if updates.present?
      # rubocop:enable Rails/SkipsModelValidations
    end
  end

  # Rebuilds the metadata-field association join tables the export carries
  # (field <-> project, field <-> host genome). Field/host-genome ids remap via the
  # reference maps built above (projects keep their ids). A row whose field isn't in
  # the bundle's metadata_fields (an inconsistent bundle) is still counted so
  # reconcile_counts! balances against the manifest; that association is dropped.
  def import_metadata_field_associations
    each_row("metadata_fields_projects") do |row|
      @stats[:metadata_fields_projects] += 1
      field_id = @metadata_field_id_map[row[:metadata_field_id]]
      project = field_id && Project.find_by(id: row[:project_id])
      next unless project

      field = MetadataField.find(field_id)
      project.metadata_fields << field unless project.metadata_fields.include?(field)
    end

    each_row("host_genomes_metadata_fields") do |row|
      @stats[:host_genomes_metadata_fields] += 1
      field_id = @metadata_field_id_map[row[:metadata_field_id]]
      host_genome_id = @host_genome_id_map[row[:host_genome_id]]
      next unless field_id && host_genome_id

      field = MetadataField.find(field_id)
      host_genome = HostGenome.find(host_genome_id)
      host_genome.metadata_fields << field unless host_genome.metadata_fields.include?(field)
    end
  end

  # Maps a reference table that must pre-exist (created by db/data migrations) by
  # name to the target's ids. Accumulates any missing names and raises once.
  def map_existing_reference(name, model)
    map = {}
    missing = []
    each_row(name) do |row|
      existing = model.find_by(name: row[:name])
      if existing
        map[row[:id]] = existing.id
        @stats[:"#{name}_skipped"] += 1
      else
        missing << row[:name]
      end
    end
    if missing.any?
      raise ImportError, "#{name} not found on target (create via db migrations first): #{missing.uniq.join(', ')}"
    end

    map
  end

  # Reuse the target row matching the natural key, else create it (validation
  # skipped, matching the rest of the import). Tracks created vs skipped stats.
  # nil attrs are dropped on create so NOT NULL columns fall back to their DB default.
  def find_or_create_ref(model, natural_key, stat_key)
    existing = model.find_by(natural_key)
    if existing
      @stats[:"#{stat_key}_skipped"] += 1
      return existing
    end

    record = model.new(yield.compact)
    record.save!(validate: false)
    @stats[stat_key] += 1
    record
  end

  def metadata_field_attrs(row)
    {
      name: row[:name],
      display_name: row[:display_name],
      description: row[:description],
      base_type: row[:base_type],
      options: row[:options],
      force_options: row[:force_options],
      is_core: row[:is_core],
      is_default: row[:is_default],
      is_required: row[:is_required],
      group: row[:group],
      examples: row[:examples],
      default_for_new_host_genome: row[:default_for_new_host_genome],
      created_at: ts(row[:created_at]),
      updated_at: ts(row[:updated_at]),
    }
  end

  # Composite natural key for locations (name + geo hierarchy).
  def location_natural_key(row)
    {
      name: row[:name],
      geo_level: row[:geo_level],
      country_name: row[:country_name],
      state_name: row[:state_name],
      subdivision_name: row[:subdivision_name],
      city_name: row[:city_name],
    }
  end

  def location_attrs(row)
    location_natural_key(row).merge(
      country_code: row[:country_code],
      osm_id: row[:osm_id],
      osm_type: row[:osm_type],
      locationiq_id: row[:locationiq_id],
      lat: row[:lat],
      lng: row[:lng],
      country_id: row[:country_id],
      state_id: row[:state_id],
      subdivision_id: row[:subdivision_id],
      city_id: row[:city_id],
      created_at: ts(row[:created_at]),
      updated_at: ts(row[:updated_at])
    )
  end

  # ===========================================================================
  # SAMPLES + PIPELINE RUNS (high volume; streamed insert_all!)
  # ===========================================================================

  def stream_samples
    stream_insert("samples", Sample) do |row|
      {
        id: row[:id],
        user_id: map_user_id(row[:user_id]),
        project_id: row[:project_id],
        host_genome_id: map_ref(@host_genome_id_map, row[:host_genome_id], "host_genomes"),
        name: row[:name],
        status: row[:status],
        sample_notes: row[:sample_notes],
        s3_preload_result_path: row[:s3_preload_result_path],
        s3_star_index_path: row[:s3_star_index_path],
        s3_bowtie2_index_path: row[:s3_bowtie2_index_path],
        subsample: row[:subsample],
        pipeline_branch: row[:pipeline_branch],
        alignment_config_name: row[:alignment_config_name],
        web_commit: row[:web_commit],
        pipeline_commit: row[:pipeline_commit],
        dag_vars: row[:dag_vars],
        max_input_fragments: row[:max_input_fragments],
        client_updated_at: parse_time(row[:client_updated_at]),
        uploaded_from_basespace: row[:uploaded_from_basespace],
        upload_error: row[:upload_error],
        basespace_access_token: row[:basespace_access_token],
        do_not_process: row[:do_not_process],
        pipeline_execution_strategy: row[:pipeline_execution_strategy],
        use_taxon_whitelist: row[:use_taxon_whitelist],
        initial_workflow: row[:initial_workflow],
        deleted_at: parse_time(row[:deleted_at]),
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end
  end

  def stream_input_files
    stream_insert("input_files", InputFile) do |row|
      {
        id: row[:id],
        sample_id: row[:sample_id],
        name: row[:name],
        presigned_url: row[:presigned_url],
        source: rewrite_s3_bucket(row[:source]),
        source_type: row[:source_type],
        upload_client: row[:upload_client],
        file_type: row[:file_type],
        parts: row[:parts],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end
  end

  def stream_metadata
    stream_insert("metadata", Metadatum, :metadata) do |row|
      {
        id: row[:id],
        sample_id: row[:sample_id],
        key: row[:key],
        raw_value: row[:raw_value],
        string_validated_value: row[:string_validated_value],
        number_validated_value: row[:number_validated_value],
        date_validated_value: parse_time(row[:date_validated_value]),
        location_id: map_ref(@location_id_map, row[:location_id], "locations"),
        metadata_field_id: map_ref(@metadata_field_id_map, row[:metadata_field_id], "metadata_fields"),
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end
  end

  def stream_pipeline_runs
    stream_insert("pipeline_runs", PipelineRun) do |row|
      {
        id: row[:id],
        sample_id: row[:sample_id],
        alignment_config_id: map_ref(@alignment_config_id_map, row[:alignment_config_id], "alignment_configs"),
        job_status: row[:job_status],
        finalized: row[:finalized],
        pipeline_version: row[:pipeline_version],
        wdl_version: row[:wdl_version],
        pipeline_commit: row[:pipeline_commit],
        pipeline_branch: row[:pipeline_branch],
        technology: row[:technology],
        deprecated: row[:deprecated],
        subsample: row[:subsample],
        max_input_fragments: row[:max_input_fragments],
        total_reads: row[:total_reads],
        adjusted_remaining_reads: row[:adjusted_remaining_reads],
        unmapped_reads: row[:unmapped_reads],
        mapped_reads: row[:mapped_reads],
        total_ercc_reads: row[:total_ercc_reads],
        fraction_subsampled: row[:fraction_subsampled],
        truncated: row[:truncated],
        total_bases: row[:total_bases],
        unmapped_bases: row[:unmapped_bases],
        fraction_subsampled_bases: row[:fraction_subsampled_bases],
        truncated_bases: row[:truncated_bases],
        qc_percent: row[:qc_percent],
        compression_ratio: row[:compression_ratio],
        alert_sent: row[:alert_sent],
        results_finalized: row[:results_finalized],
        time_to_finalized: row[:time_to_finalized],
        time_to_results_finalized: row[:time_to_results_finalized],
        executed_at: parse_time(row[:executed_at]),
        assembled: row[:assembled],
        s3_output_prefix: rewrite_s3_bucket(row[:s3_output_prefix]),
        pipeline_execution_strategy: row[:pipeline_execution_strategy],
        sfn_execution_arn: row[:sfn_execution_arn],
        use_taxon_whitelist: row[:use_taxon_whitelist],
        dag_vars: row[:dag_vars],
        guppy_basecaller_setting: row[:guppy_basecaller_setting],
        error_message: row[:error_message],
        known_user_error: row[:known_user_error],
        deleted_at: parse_time(row[:deleted_at]),
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end
  end

  def stream_pipeline_run_children
    stream_insert("taxon_counts", TaxonCount) do |row|
      {
        id: row[:id],
        pipeline_run_id: row[:pipeline_run_id],
        tax_id: row[:tax_id],
        tax_level: row[:tax_level],
        count_type: row[:count_type],
        count: row[:count],
        percent_identity: row[:percent_identity],
        percent_identity_decimal: row[:percent_identity_decimal],
        alignment_length: row[:alignment_length],
        alignment_length_decimal: row[:alignment_length_decimal],
        e_value: row[:e_value],
        rpm: row[:rpm],
        rpm_decimal: row[:rpm_decimal],
        base_count: row[:base_count],
        bpm: row[:bpm],
        genus_taxid: row[:genus_taxid],
        family_taxid: row[:family_taxid],
        superkingdom_taxid: row[:superkingdom_taxid],
        name: row[:name],
        common_name: row[:common_name],
        is_phage: row[:is_phage],
        source_count_type: row[:source_count_type],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end

    stream_insert("job_stats", JobStat) do |row|
      {
        id: row[:id],
        pipeline_run_id: row[:pipeline_run_id],
        task: row[:task],
        reads_after: row[:reads_after],
        bases_after: row[:bases_after],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end

    stream_insert("contigs", Contig) do |row|
      {
        id: row[:id],
        pipeline_run_id: row[:pipeline_run_id],
        name: row[:name],
        sequence: row[:sequence],
        read_count: row[:read_count],
        base_count: row[:base_count],
        lineage_json: row[:lineage_json],
        species_taxid_nt: row[:species_taxid_nt],
        species_taxid_nr: row[:species_taxid_nr],
        genus_taxid_nt: row[:genus_taxid_nt],
        genus_taxid_nr: row[:genus_taxid_nr],
        species_taxid_merged_nt_nr: row[:species_taxid_merged_nt_nr],
        genus_taxid_merged_nt_nr: row[:genus_taxid_merged_nt_nr],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end

    stream_insert("ercc_counts", ErccCount) do |row|
      {
        id: row[:id],
        pipeline_run_id: row[:pipeline_run_id],
        name: row[:name],
        count: row[:count],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end

    stream_insert("annotations", Annotation) do |row|
      {
        id: row[:id],
        pipeline_run_id: row[:pipeline_run_id],
        tax_id: row[:tax_id],
        content: row[:content],
        creator_id: map_user_id(row[:creator_id]),
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end

    stream_insert("output_states", OutputState) do |row|
      {
        id: row[:id],
        pipeline_run_id: row[:pipeline_run_id],
        output: row[:output],
        state: row[:state],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end

    stream_insert("insert_size_metric_sets", InsertSizeMetricSet) do |row|
      {
        id: row[:id],
        pipeline_run_id: row[:pipeline_run_id],
        median: row[:median],
        mode: row[:mode],
        median_absolute_deviation: row[:median_absolute_deviation],
        min: row[:min],
        max: row[:max],
        mean: row[:mean],
        standard_deviation: row[:standard_deviation],
        read_pairs: row[:read_pairs],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end

    stream_insert("pipeline_run_stages", PipelineRunStage) do |row|
      {
        id: row[:id],
        pipeline_run_id: row[:pipeline_run_id],
        step_number: row[:step_number],
        name: row[:name],
        job_type: row[:job_type],
        job_status: row[:job_status],
        db_load_status: row[:db_load_status],
        job_command: row[:job_command],
        command_stdout: row[:command_stdout],
        command_stderr: row[:command_stderr],
        command_status: row[:command_status],
        job_description: row[:job_description],
        job_log_id: row[:job_log_id],
        job_id: row[:job_id],
        job_progress_pct: row[:job_progress_pct],
        job_command_func: row[:job_command_func],
        load_db_command_func: row[:load_db_command_func],
        output_func: row[:output_func],
        failed_jobs: row[:failed_jobs],
        dag_json: row[:dag_json],
        executed_at: parse_time(row[:executed_at]),
        time_to_finalized: row[:time_to_finalized],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end

    stream_insert("taxon_byteranges", TaxonByterange) do |row|
      {
        id: row[:id],
        pipeline_run_id: row[:pipeline_run_id],
        taxid: row[:taxid],
        hit_type: row[:hit_type],
        first_byte: row[:first_byte],
        last_byte: row[:last_byte],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end

    stream_insert("accession_coverage_stats", AccessionCoverageStat) do |row|
      {
        id: row[:id],
        pipeline_run_id: row[:pipeline_run_id],
        accession_id: row[:accession_id],
        accession_name: row[:accession_name],
        taxid: row[:taxid],
        num_contigs: row[:num_contigs],
        num_reads: row[:num_reads],
        score: row[:score],
        coverage_breadth: row[:coverage_breadth],
        coverage_depth: row[:coverage_depth],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end

    stream_insert("amr_counts", AmrCount) do |row|
      {
        id: row[:id],
        pipeline_run_id: row[:pipeline_run_id],
        gene: row[:gene],
        allele: row[:allele],
        coverage: row[:coverage],
        depth: row[:depth],
        drug_family: row[:drug_family],
        annotation_gene: row[:annotation_gene],
        genbank_accession: row[:genbank_accession],
        total_reads: row[:total_reads],
        rpm: row[:rpm],
        dpm: row[:dpm],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end
  end

  def stream_workflow_runs
    stream_insert("workflow_runs", WorkflowRun) do |row|
      {
        id: row[:id],
        sample_id: row[:sample_id],
        user_id: map_user_id(row[:user_id]),
        workflow: row[:workflow],
        status: row[:status],
        wdl_version: row[:wdl_version],
        executed_at: parse_time(row[:executed_at]),
        deprecated: row[:deprecated],
        inputs_json: row[:inputs_json],
        cached_results: row[:cached_results],
        rerun_from: row[:rerun_from],
        sfn_execution_arn: row[:sfn_execution_arn],
        s3_output_prefix: rewrite_s3_bucket(row[:s3_output_prefix]),
        time_to_finalized: row[:time_to_finalized],
        error_message: row[:error_message],
        temp_cg_coverage_viz: row[:temp_cg_coverage_viz],
        deleted_at: parse_time(row[:deleted_at]),
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end
  end

  # ===========================================================================
  # LOW-VOLUME ENTITIES WITH JOIN REBUILDS
  # ===========================================================================

  def import_visualizations
    each_row("visualizations") do |row|
      viz = insert_one(Visualization, :visualizations, {
                         id: row[:id],
                         user_id: map_user_id(row[:user_id]),
                         name: row[:name],
                         visualization_type: row[:visualization_type],
                         data: row[:data],
                         public_access: row[:public_access],
                         status: row[:status],
                         created_at: ts(row[:created_at]),
                         updated_at: ts(row[:updated_at]),
                       })

      associate_by_ids(viz, :samples, Sample, row[:sample_ids], "Visualization #{viz.id}")
    end
  end

  def import_phylo_trees
    each_row("phylo_trees") do |row|
      tree = insert_one(PhyloTree, :phylo_trees, {
                          id: row[:id],
                          user_id: map_user_id(row[:user_id]),
                          project_id: row[:project_id],
                          name: import_name(PhyloTree, :phylo_trees, row[:id], row[:name]),
                          taxid: row[:taxid],
                          tax_level: row[:tax_level],
                          tax_name: row[:tax_name],
                          status: row[:status],
                          newick: row[:newick],
                          dag_version: row[:dag_version],
                          dag_json: row[:dag_json],
                          dag_branch: row[:dag_branch],
                          dag_vars: row[:dag_vars],
                          command_stdout: row[:command_stdout],
                          command_stderr: row[:command_stderr],
                          job_id: row[:job_id],
                          job_log_id: row[:job_log_id],
                          job_description: row[:job_description],
                          ncbi_metadata: row[:ncbi_metadata],
                          snp_annotations: row[:snp_annotations],
                          vcf: row[:vcf],
                          ready_at: parse_time(row[:ready_at]),
                          deleted_at: parse_time(row[:deleted_at]),
                          created_at: ts(row[:created_at]),
                          updated_at: ts(row[:updated_at]),
                        })

      associate_by_ids(tree, :pipeline_runs, PipelineRun, row[:pipeline_run_ids], "PhyloTree #{tree.id}")
    end
  end

  def import_phylo_tree_ngs
    each_row("phylo_tree_ngs") do |row|
      tree = insert_one(PhyloTreeNg, :phylo_tree_ngs, {
                          id: row[:id],
                          user_id: map_user_id(row[:user_id]),
                          project_id: row[:project_id],
                          name: row[:name],
                          status: row[:status],
                          tax_id: row[:tax_id],
                          inputs_json: row[:inputs_json],
                          sfn_execution_arn: row[:sfn_execution_arn],
                          s3_output_prefix: rewrite_s3_bucket(row[:s3_output_prefix]),
                          wdl_version: row[:wdl_version],
                          rerun_from: row[:rerun_from],
                          executed_at: parse_time(row[:executed_at]),
                          deprecated: row[:deprecated],
                          deleted_at: parse_time(row[:deleted_at]),
                          created_at: ts(row[:created_at]),
                          updated_at: ts(row[:updated_at]),
                        })

      associate_by_ids(tree, :pipeline_runs, PipelineRun, row[:pipeline_run_ids], "PhyloTreeNg #{tree.id}")
    end
  end

  def import_backgrounds
    each_row("backgrounds") do |row|
      bg = insert_one(Background, :backgrounds, {
                        id: row[:id],
                        user_id: map_user_id(row[:user_id]),
                        name: import_name(Background, :backgrounds, row[:id], row[:name]),
                        description: row[:description],
                        public_access: row[:public_access],
                        ready: row[:ready],
                        mass_normalized: row[:mass_normalized],
                        created_at: ts(row[:created_at]),
                        updated_at: ts(row[:updated_at]),
                      })

      associate_by_ids(bg, :pipeline_runs, PipelineRun, row[:pipeline_run_ids], "Background #{bg.id}")
    end
  end

  def stream_taxon_summaries
    stream_insert("taxon_summaries", TaxonSummary) do |row|
      {
        id: row[:id],
        background_id: row[:background_id],
        tax_id: row[:tax_id],
        tax_level: row[:tax_level],
        count_type: row[:count_type],
        mean: row[:mean],
        stdev: row[:stdev],
        rpm_list: row[:rpm_list],
        mean_mass_normalized: row[:mean_mass_normalized],
        stdev_mass_normalized: row[:stdev_mass_normalized],
        rel_abundance_list_mass_normalized: row[:rel_abundance_list_mass_normalized],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end
  end

  def import_bulk_downloads
    each_row("bulk_downloads") do |row|
      bd = insert_one(BulkDownload, :bulk_downloads, {
                        id: row[:id],
                        user_id: map_user_id(row[:user_id]),
                        download_type: row[:download_type],
                        status: row[:status],
                        error_message: row[:error_message],
                        description: row[:description],
                        params_json: row[:params_json],
                        access_token: row[:access_token],
                        progress: row[:progress],
                        ecs_task_arn: row[:ecs_task_arn],
                        output_file_size: row[:output_file_size],
                        deleted_at: parse_time(row[:deleted_at]),
                        created_at: ts(row[:created_at]),
                        updated_at: ts(row[:updated_at]),
                      })

      associate_by_ids(bd, :pipeline_runs, PipelineRun, row[:pipeline_run_ids], "BulkDownload #{bd.id}")
      associate_by_ids(bd, :workflow_runs, WorkflowRun, row[:workflow_run_ids], "BulkDownload #{bd.id}")
    end
  end

  def stream_persisted_backgrounds
    stream_insert("persisted_backgrounds", PersistedBackground) do |row|
      {
        id: row[:id],
        user_id: map_user_id(row[:user_id]),
        project_id: row[:project_id],
        background_id: row[:background_id],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end
  end

  def stream_snapshot_links
    stream_insert("snapshot_links", SnapshotLink) do |row|
      {
        id: row[:id],
        project_id: row[:project_id],
        creator_id: map_user_id(row[:creator_id]),
        share_id: row[:share_id],
        content: row[:content],
        created_at: ts(row[:created_at]),
        updated_at: ts(row[:updated_at]),
      }
    end
  end

  # ===========================================================================
  # HELPERS
  # ===========================================================================

  # Remap a user reference: the migrated user's old id becomes the new id;
  # references to any other user are left unchanged.
  def map_user_id(value)
    value == @old_user_id ? @new_user_id : value
  end

  # Rewrite a reference FK from its source id to the target id built in
  # import_reference_tables. nil passes through; an unmapped non-nil id means the
  # bundle omitted a referenced reference row (inconsistent export) -- fail loudly.
  def map_ref(map, source_id, table)
    return nil if source_id.nil?

    map.fetch(source_id) do
      raise ImportError, "#{table} id #{source_id} referenced but not present in the bundle's #{table} table"
    end
  end

  # Rewrite a stored S3 URI from the source samples bucket to the destination
  # bucket. No-op unless bucket rewriting is enabled and the value is an
  # `s3://<source_bucket>/...` URI, so reference paths (other buckets) and
  # non-S3 values (e.g. presigned HTTPS URLs, basespace sources) pass through.
  def rewrite_s3_bucket(value)
    return value unless @rewrite_s3_bucket
    return value unless value.is_a?(String) && value.start_with?(@source_uri_prefix)

    "s3://#{@dest_bucket}/#{value.delete_prefix(@source_uri_prefix)}"
  end

  # Associate a record with related records (preserved IDs) via a collection
  # association, warning for any IDs that aren't present in the target DB.
  def associate_by_ids(record, association, model, ids, label)
    (ids || []).each do |related_id|
      related = model.find_by(id: related_id)
      if related
        collection = record.public_send(association)
        collection << related unless collection.include?(related)
      else
        @warnings << "#{label}: Could not find #{model.name} with id #{related_id}"
      end
    end
  end

  def parse_time(time_string)
    return nil if time_string.blank?

    Time.zone.parse(time_string)
  rescue ArgumentError
    nil
  end

  # created_at/updated_at coalesced to import time ONLY when the source value is
  # absent: insert_all! does not run the timestamp callback and these columns are
  # NOT NULL, so a value is required. Every fabricated value is counted
  # (@timestamps_defaulted) and surfaced as a warning, so a made-up timestamp is
  # never silent.
  def ts(time_string)
    parsed = parse_time(time_string)
    return parsed if parsed

    @timestamps_defaulted += 1
    Time.current
  end

  def reset_counter_caches
    Rails.logger.info("UserDataImport: Resetting counter caches...")

    User.reset_counters(@new_user_id, :samples, :visualizations, :phylo_trees)

    # Note: HostGenome counter cache should be reset separately if needed
    # since it's reference data shared across all users.

    Rails.logger.info("UserDataImport: Counter caches reset complete")
  end

  # ===========================================================================
  # PRE-WRITE VALIDATION (read-only) -- also the whole of a dry run
  # ===========================================================================

  # Every failure the import can detect from the bundle itself, checked WITHOUT writing:
  #   * each table file has exactly the row count the manifest declares (truncated / partial bundle);
  #   * reference rows that must pre-exist on the target (host_genomes, alignment_configs) do;
  #   * create_user mode: the user's email is not already taken (unless skip_existing);
  #   * no imported primary key already exists on the target (unless skip_existing, which skips them).
  # Raises ValidationError / ImportError / DuplicateUserError exactly as the write path would have, but
  # before anything is committed. Counts what it saw into @stats (rows per table; <table>_existing_ids for
  # the first colliding batch when it refuses).
  def validate_before_write!
    # Cheap checks first, so a duplicate user reports as such rather than as a primary-key collision.
    if @create_user && !@skip_existing && (existing = User.find_by(email: @user_data[:email]))
      raise DuplicateUserError, "User with email #{@user_data[:email]} already exists (ID: #{existing.id})"
    end

    file_mismatches = []
    @expected_counts.each do |table, expected|
      rows = 0
      model = model_for_table(table)
      if model && collision_checked?(table)
        each_row_batch(table) do |batch|
          rows += batch.size
          ids = batch.filter_map { |r| r[:id] }
          next if ids.empty?

          existing_ids = model.where(id: ids).count
          raise_primary_keys_exist!(table, existing_ids) if existing_ids.positive?
        end
      else
        # No ids needed: count lines without JSON-parsing them (a 75M-row bundle parses for a long time).
        rows = count_rows(table)
      end
      file_mismatches << "#{table}: manifest=#{expected} file=#{rows}" if rows != expected.to_i
      @stats[:"#{table}_in_bundle"] = rows
    end
    raise ImportError, "Row count mismatch (incomplete bundle?): #{file_mismatches.join('; ')}" if file_mismatches.any?

    check_reference_rows_exist!("host_genomes", HostGenome)
    check_reference_rows_exist!("alignment_configs", AlignmentConfig)
    count_name_conflicts
  end

  # Primary-key collisions are checked up front only when they would be an error: not with skip_existing (the
  # import checks every existing id batch by batch in partition_existing -- skipping the same record, stopping
  # on a different one -- so counting them up front was a second full pass over the bundle), and never for reference tables (remapped by natural key, not inserted by id) or
  # projects (MERGED when they already exist: a shared project imported once per member).
  def collision_checked?(table)
    !@skip_existing && !(REFERENCE_TABLES + MERGED_BY_ID_TABLES).include?(table.to_s)
  end

  # Stops at the FIRST colliding batch instead of scanning the rest of the bundle: one collision already
  # means "re-run with skip_existing", so a partially imported export fails in seconds instead of after a
  # read-only pass over every table (seen with a 75M-row export in the 2026-10-22 next-prod lab).
  def raise_primary_keys_exist!(table, count)
    @stats[:"#{table}_existing_ids"] = count
    raise ImportError, "Primary keys already exist on the target (#{table}: #{count} in the first colliding batch); " \
                       "re-run with mode skip_existing to import only the missing rows"
  end

  # Read-only: how many imported names will be renamed (see import_name), so a dry run surfaces them.
  def count_name_conflicts
    NAME_UNIQUE_TABLES.each do |table, model_name|
      model = model_name.constantize
      conflicts = 0
      each_row(table) do |row|
        name = row[:name].to_s.strip
        next if name.empty? || model.exists?(row[:id])

        conflicts += 1 if name_taken?(model, name, row[:id])
      end
      @stats[:"#{table}_name_conflicts"] = conflicts if conflicts.positive?
    end
  end

  REFERENCE_TABLES = %w[host_genomes alignment_configs metadata_fields locations].freeze
  MERGED_BY_ID_TABLES = %w[projects].freeze

  def check_reference_rows_exist!(name, model)
    missing = []
    each_row(name) { |row| missing << row[:name] unless model.exists?(name: row[:name]) }
    return if missing.empty?

    raise ImportError, "#{name} not found on target (create via db migrations first): #{missing.uniq.join(', ')}"
  end

  # Yields INSERT_BATCH-sized arrays of parsed rows (read-only streaming).
  def each_row_batch(name)
    buffer = []
    each_row(name) do |row|
      buffer << row
      if buffer.size >= @insert_batch
        yield buffer
        buffer = []
      end
    end
    yield buffer unless buffer.empty?
  end

  # The ActiveRecord model whose table is `table`, or nil (join tables / unknown).
  def model_for_table(table)
    model = table.to_s.classify.safe_constantize
    model if model.is_a?(Class) && model < ActiveRecord::Base && model.table_name == table.to_s
  end

  # ===========================================================================
  # YIELDING TO THE APP
  # ===========================================================================

  # One import at a time by default (MySQL named lock, released when the session ends); per export with
  # IMPORT_LOCK_SCOPE=export. A conflicting import fails fast instead of piling more load onto the database.
  IMPORT_LOCK_NAME = "seqtoid_user_data_import"

  # "global": the one shared name (one import at a time). "export": scoped to the bundle's source user, so
  # different exports run in parallel while the same export can never run twice at once.
  def import_lock_name
    @lock_scope == "export" ? "#{IMPORT_LOCK_NAME}:u#{@old_user_id}" : IMPORT_LOCK_NAME
  end

  def check_target_db_host!
    required = ENV[REQUIRE_DB_HOST_ENV].to_s.strip
    return if required.empty?

    connected = ActiveRecord::Base.connection_db_config.configuration_hash[:host].to_s
    return if connected.casecmp?(required)

    raise ImportError, "Refusing to import: connected to database host '#{connected}' but #{REQUIRE_DB_HOST_ENV}='#{required}'"
  end

  def with_import_lock
    conn = ActiveRecord::Base.connection
    return yield unless conn.adapter_name.to_s.match?(/mysql|trilogy/i)

    acquired = conn.select_value("SELECT GET_LOCK(#{conn.quote(import_lock_name)}, 0)").to_i == 1
    raise ImportError, "Another user-data import is already running (named lock #{import_lock_name}); retry when it finishes" unless acquired

    begin
      yield
    ensure
      conn.select_value("SELECT RELEASE_LOCK(#{conn.quote(import_lock_name)})")
    end
  end

  # The import waits at most IMPORT_LOCK_WAIT_SECONDS for a row lock (the server default is 50s), so on
  # contention the IMPORT backs off and retries (with_lock_retry) instead of an app request waiting.
  IMPORT_LOCK_WAIT_SECONDS = 5
  LOCK_RETRY_ATTEMPTS = 8
  LOCK_RETRY_MAX_SLEEP = 30

  def yield_locks_to_app!
    conn = ActiveRecord::Base.connection
    return unless conn.adapter_name.to_s.match?(/mysql|trilogy/i)

    conn.execute("SET SESSION innodb_lock_wait_timeout = #{IMPORT_LOCK_WAIT_SECONDS}")
  end

  # Retries a single-statement write that lost a lock conflict, with exponential backoff. Safe because a
  # failed statement changes nothing. Inside the legacy single transaction a lock error aborts it, so no
  # retry there.
  def with_lock_retry
    attempt = 0
    begin
      yield
    rescue ActiveRecord::LockWaitTimeout, ActiveRecord::Deadlocked => e
      raise if @single_transaction || ActiveRecord::Base.connection.transaction_open?

      attempt += 1
      raise if attempt >= LOCK_RETRY_ATTEMPTS

      pause = [2**attempt, LOCK_RETRY_MAX_SLEEP].min
      Rails.logger.warn("UserDataImport: #{e.class} (attempt #{attempt}); yielding to the app for #{pause}s")
      sleep(pause)
      retry
    end
  end
end

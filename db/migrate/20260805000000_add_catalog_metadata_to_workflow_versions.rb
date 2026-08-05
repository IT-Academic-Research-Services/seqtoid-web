class AddCatalogMetadataToWorkflowVersions < ActiveRecord::Migration[7.2]
  # CZID-973 -- make `workflow_versions` a REPRODUCIBLE catalog rather than a list of names.
  #
  # Until now a row said only "this workflow/version exists, and it is runnable". That is enough to
  # gate dispatch (CZID-982) but not enough to reproduce a run: nothing recorded which image the
  # version resolves to, whether its S3 bundle is still intact, when it was published, or which
  # engine can execute it. The publisher (CZID-971) already computes all of this into the bundle's
  # manifest.json; these columns are where it lands in the app.
  #
  # All additive and nullable. Rows that predate the publisher -- the seeded ones and the ones the
  # CZID-982 reconciliation created -- keep working untouched, and honestly report "unknown" for the
  # provenance they never had. Only `engines` is backfilled, because dispatch has to know what can
  # run a version and every existing row is in fact runnable on SWIPE today.
  #
  # CZID-992 -- every step below is GUARDED so this migration is safely re-runnable.
  #
  # MySQL DDL is not transactional: each `add_column` auto-commits on its own. If the process dies
  # partway -- pod evicted, `lock_wait_timeout` hit on a later column, OOM -- the columns that
  # already landed stay landed, but the migration is never recorded in `schema_migrations`. The next
  # run starts from the top and dies on `Duplicate column name`, and since this runs as an Argo
  # PreSync hook, a failed migration aborts the entire sync.
  #
  # That is not hypothetical: it wedged dev for five consecutive deploys. The only visible signal was
  # the Argo app sitting at OutOfSync / *Healthy* -- "Healthy" describes the old pods still happily
  # serving, so nothing alarmed and the deploys just silently stopped landing.
  #
  # The guards make a retry CONVERGE rather than repeat the failure: columns already present are
  # skipped, missing ones are added, and the run reaches the end and records itself. Staging and prod
  # have not applied this yet and would otherwise be exposed to the identical trap.
  def up
    add_column_unless_present :image_digest, :string,
                              "Immutable image content digest (sha256:...) this version resolves to. A tag is mutable; a digest reproduces. Nil for rows that predate the publisher."
    add_column_unless_present :wdl_checksum, :string,
                              "Checksum over the published WDL bundle's source files, for detecting drift or tampering in S3. Nil for rows that predate the publisher."
    add_column_unless_present :published_at, :datetime,
                              "When the publisher released this version. Nil for rows that predate the publisher; NOT a created_at substitute."
    add_column_unless_present :tier, :string,
                              "Backfill tier: full (built + validated), lazy (WDL published, image built on first request), record_only (catalogued but not buildable). Nil = not classified by the backfill."
    add_column_unless_present :engines, :json,
                              "Runners that may execute this version, e.g. [\"swipe\"] or [\"swipe\",\"k8s\"]. Lets the K8s runner be opted in per version."
    add_column_unless_present :notes, :text,
                              "Human-readable context surfaced in the UI, e.g. why a version is not runnable (EOL base image)."

    # Every existing row is runnable on SWIPE today -- that is the only engine there is. Backfilling
    # rather than relying on a NULL default keeps dispatch from having to special-case nil, and
    # MySQL cannot take a literal DEFAULT on a JSON column anyway.
    #
    # `WHERE engines IS NULL` is what makes this safe to repeat: a re-run touches only rows still
    # unset, and never overwrites an engine list the publisher has since recorded.
    #
    # safety_assured because strong_migrations cannot see inside an `execute` and so refuses it
    # outright. This is a one-shot backfill of a column added moments earlier in the same migration:
    # it takes no lock beyond the row updates, and workflow_versions is a small catalog table (tens
    # of rows), not a user-data table where a blocking UPDATE would matter.
    #
    # THIS is what actually wedged dev. The migration added its six columns, reached here, and
    # strong_migrations aborted it -- after the DDL had auto-committed but before the migration was
    # recorded in schema_migrations. Every retry then died earlier still, on "Duplicate column name",
    # which masked this line as the real cause. The CZID-992 guards fixed the retry; this fixes the
    # reason there was anything to retry.
    safety_assured do
      execute <<~SQL.squish
        UPDATE workflow_versions
        SET engines = CAST('["swipe"]' AS JSON)
        WHERE engines IS NULL
      SQL
    end
  end

  def down
    [:image_digest, :wdl_checksum, :published_at, :tier, :engines, :notes].each do |column|
      remove_column :workflow_versions, column if column_exists?(:workflow_versions, column)
    end
  end

  private

  def add_column_unless_present(column, type, comment)
    if column_exists?(:workflow_versions, column)
      say "skipping #{column}: already present (re-run of a partially applied migration)"
      return
    end

    add_column :workflow_versions, column, type, comment: comment
  end
end

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
  def up
    add_column :workflow_versions, :image_digest, :string,
               comment: "Immutable image content digest (sha256:...) this version resolves to. A tag is mutable; a digest reproduces. Nil for rows that predate the publisher."
    add_column :workflow_versions, :wdl_checksum, :string,
               comment: "Checksum over the published WDL bundle's source files, for detecting drift or tampering in S3. Nil for rows that predate the publisher."
    add_column :workflow_versions, :published_at, :datetime,
               comment: "When the publisher released this version. Nil for rows that predate the publisher; NOT a created_at substitute."
    add_column :workflow_versions, :tier, :string,
               comment: "Backfill tier: full (built + validated), lazy (WDL published, image built on first request), record_only (catalogued but not buildable). Nil = not classified by the backfill."
    add_column :workflow_versions, :engines, :json,
               comment: "Runners that may execute this version, e.g. [\"swipe\"] or [\"swipe\",\"k8s\"]. Lets the K8s runner be opted in per version."
    add_column :workflow_versions, :notes, :text,
               comment: "Human-readable context surfaced in the UI, e.g. why a version is not runnable (EOL base image)."

    # Every existing row is runnable on SWIPE today -- that is the only engine there is. Backfilling
    # rather than relying on a NULL default keeps dispatch from having to special-case nil, and
    # MySQL cannot take a literal DEFAULT on a JSON column anyway.
    execute <<~SQL.squish
      UPDATE workflow_versions
      SET engines = CAST('["swipe"]' AS JSON)
      WHERE engines IS NULL
    SQL
  end

  def down
    remove_column :workflow_versions, :image_digest
    remove_column :workflow_versions, :wdl_checksum
    remove_column :workflow_versions, :published_at
    remove_column :workflow_versions, :tier
    remove_column :workflow_versions, :engines
    remove_column :workflow_versions, :notes
  end
end

class AddIndexCompatibilityToWorkflowVersions < ActiveRecord::Migration[7.2]
  # CZID-977 -- record which NCBI index vintages a pipeline version may be paired with.
  #
  # The real constraint on running an older pipeline is the reference data, not the WDL. Pipeline
  # version and index vintage are pinned INDEPENDENTLY today (ncbi_index_date is its own
  # workflow_versions row; AlignmentConfig::NCBI_INDEX is pinned per project), and nothing checks the
  # pairing. Per-run version selection (CZID-975/976) made an arbitrary pairing reachable from the
  # UI, and the failure is silent: an old pipeline on a new index runs to completion and can simply
  # be wrong.
  #
  # Stored as an inclusive range because one version legitimately spans several vintages -- dev
  # short-read-mngs 8.3.15 has run against both 2024-02-06 (103 runs) and 2026-07-09 (59 runs).
  #
  # NULL means UNBOUNDED on that side, i.e. no constraint recorded. That is deliberate: the actual
  # boundaries are a scientific judgment about reference-data format and content, and nothing in this
  # codebase records them (the only index reference in the WDL is a hardcoded default the app
  # overrides, one of which is marked "FIXME: vestigial input"). Inventing values would create false
  # confidence and could block legitimate runs. The enforcement is therefore inert until a domain
  # owner populates the bounds -- which is the point at which this actually mitigates the risk.
  #
  # Compared using WorkflowVersion.version_sort_key, which already orders these ISO dates correctly
  # (CZID-972) and is the same comparison used for semver.
  def change
    add_column :workflow_versions, :min_index_version, :string,
               comment: "Oldest NCBI index vintage (ncbi_index_date, e.g. 2024-02-06) this workflow version may run against. NULL = no lower bound recorded (CZID-977)."
    add_column :workflow_versions, :max_index_version, :string,
               comment: "Newest NCBI index vintage this workflow version may run against. NULL = no upper bound recorded (CZID-977)."
  end
end

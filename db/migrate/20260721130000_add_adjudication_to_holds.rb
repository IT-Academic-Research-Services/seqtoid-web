class AddAdjudicationToHolds < ActiveRecord::Migration[7.2]
  # SMP-1253 (export-control audit trail) -- make the human Incident Manager
  # adjudication a DURABLE record on the hold itself, not just a released_at
  # timestamp plus an ephemeral log line.
  #
  # Before this, a still-active hold was ambiguous: it could mean "never
  # adjudicated" OR "reviewed and denied (True Hit)" -- indistinguishable in the
  # system-of-record. These columns capture which terminal IM verdict was applied
  # (resolution_status), the normalized outcome (disposition), the resolving IM
  # incident id, and when the verdict landed (resolved_at). A True Hit now leaves
  # the hold in force AND records the review.
  #
  # All nullable/additive; the columns stay empty until the OFF-by-default
  # ENABLE_DESCARTES_SCREENING flag enables the poller that writes them.
  def change
    add_column :holds, :disposition, :string, comment: "Terminal IM adjudication outcome: released or denied. Nil while the hold is unadjudicated."
    add_column :holds, :resolution_status, :string, comment: "Raw Descartes IM verdict that resolved the hold (e.g. Cleared, False Hit, CRI Auto-Clear, True Hit)."
    add_column :holds, :incident_id, :string, comment: "Resolving Descartes IM record id (SHresult id) that adjudicated this hold."
    add_column :holds, :resolved_at, :datetime, comment: "When a terminal IM verdict was applied. Equals released_at for a release; set on a deny while released_at stays nil."
  end
end

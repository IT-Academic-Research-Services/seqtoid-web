# Per-user cap on concurrently running pipeline runs (PipelineDispatchThrottle): mNGS pipeline runs and
# consensus-genome / AMR workflow runs. A run held back because its uploader is at the cap records WHEN it
# was deferred; ReleaseDeferredPipelineRuns dispatches deferred runs oldest-first as the user's earlier runs
# finish. NULL = never deferred (every run today).
class AddDispatchDeferredAtForRunCap < ActiveRecord::Migration[7.2]
  COMMENT = "Set while the run waits for its uploader's concurrent-run cap; cleared when dispatched.".freeze

  def change
    add_column :pipeline_runs, :dispatch_deferred_at, :datetime, null: true, if_not_exists: true, comment: COMMENT
    add_index :pipeline_runs, :dispatch_deferred_at, if_not_exists: true
    add_column :workflow_runs, :dispatch_deferred_at, :datetime, null: true, if_not_exists: true, comment: COMMENT
    add_index :workflow_runs, :dispatch_deferred_at, if_not_exists: true
  end
end

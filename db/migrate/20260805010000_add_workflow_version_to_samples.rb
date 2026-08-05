class AddWorkflowVersionToSamples < ActiveRecord::Migration[7.2]
  # CZID-976 -- carry the pipeline version the USER selected at upload.
  #
  # Mirrors how the other per-upload run options already work: `alignment_config_name` and
  # `pipeline_branch` are columns on `samples` that dispatch reads and resolves. This is the same
  # shape for the workflow version, so dispatch can pass it to VersionRetrievalService as the
  # user-specified prefix.
  #
  # Deliberately the REQUEST, not the result: `pipeline_runs.wdl_version` and
  # `workflow_runs.wdl_version` continue to record the version that actually ran. Keeping the two
  # apart means a run's provenance shows both what was asked for and what it resolved to.
  #
  # Nullable: nil means "no explicit selection", which is every sample uploaded before this and every
  # upload that just takes the project default.
  def change
    add_column :samples, :workflow_version, :string,
               comment: "Pipeline version explicitly selected by the user at upload (CZID-976). Nil = use the project pin / configured default. This is the REQUEST; pipeline_runs.wdl_version records what actually ran."
  end
end

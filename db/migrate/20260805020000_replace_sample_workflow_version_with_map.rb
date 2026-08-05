class ReplaceSampleWorkflowVersionWithMap < ActiveRecord::Migration[7.2]
  # CZID-975/CZID-976 -- the user's version selection has to be PER WORKFLOW, not per sample.
  #
  # CZID-976 added `samples.workflow_version` as a single string. That is wrong as soon as an upload
  # runs more than one workflow, which is a supported and common case: the upload flow explicitly
  # allows short-read-mngs and amr together
  # (ALLOWED_UPLOAD_WORKFLOWS_BY_TECHNOLOGY[AMR][ILLUMINA] == [amr, mngs]).
  #
  # With one string, selecting AMR 1.4.2 on an mNGS+AMR upload writes "1.4.2" for the sample, and
  # then the mNGS dispatch resolves "1.4.2" against the short-read-mngs catalog, finds nothing, and
  # raises -- the mNGS run fails because of a choice the user made about AMR.
  #
  # Replaced by a map keyed by workflow, e.g. {"amr": "1.4.2", "short-read-mngs": "8.1.2"}, so each
  # dispatch reads only its own selection and an unselected workflow keeps the project default.
  #
  # Dropping the old column is safe: nothing ever wrote it. CZID-976 added it and the only writer
  # (the upload flow, CZID-975) is not merged, so it is empty everywhere by construction.
  #
  # CZID-992 -- both steps are guarded, because this is a DROP followed by an ADD and MySQL DDL does
  # not roll back. If the process dies between them the drop stays committed and the migration is
  # never recorded, so the retry re-runs the drop and fails with "Can't DROP 'workflow_version'".
  # That wedges the Argo PreSync hook and therefore every subsequent deploy -- exactly how
  # 20260805000000 took dev down for five deploys. Guarded, a retry simply finishes the half it has
  # left to do.
  def up
    remove_column :samples, :workflow_version if column_exists?(:samples, :workflow_version)

    unless column_exists?(:samples, :workflow_versions)
      add_column :samples, :workflow_versions, :json,
                 comment: "Per-workflow pipeline versions the user selected at upload, e.g. {\"amr\":\"1.4.2\"} (CZID-975). A workflow absent from the map uses the project pin / configured default. This is the REQUEST; pipeline_runs.wdl_version and workflow_runs.wdl_version record what actually ran."
    end
  end

  def down
    remove_column :samples, :workflow_versions if column_exists?(:samples, :workflow_versions)

    unless column_exists?(:samples, :workflow_version)
      add_column :samples, :workflow_version, :string,
                 comment: "Pipeline version explicitly selected by the user at upload (CZID-976). Nil = use the project pin / configured default. This is the REQUEST; pipeline_runs.wdl_version records what actually ran."
    end
  end
end

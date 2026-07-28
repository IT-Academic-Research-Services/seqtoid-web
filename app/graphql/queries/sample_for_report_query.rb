module Queries
  # Ported from the GraphQL federation server (resolver-functions/SampleForReport) as part
  # of CZID-310 (a fed* read op missed in 303, needed for the SampleView report page and the
  # CZID-305 cutover). Serves `SampleForReport` natively instead of proxying
  # GET /samples/:id.json. Mirrors SamplesController#show's JSON, then applies the
  # federation's id-stringification (pipeline_runs/workflow_runs/default_pipeline_run/project).
  #
  # snapshotLinkId authorizes a public shared-link ("/pub/:share_id") view: the viewer is
  # unauthenticated, so the sample is loaded via the SnapshotLink instead of current_power
  # (SMP-1457). See Queries::Concerns::SnapshotSampleAuthorization.
  module SampleForReportQuery
    extend ActiveSupport::Concern

    included do
      field :SampleForReport,
            Types::SampleForReportType,
            null: true,
            camelize: false,
            resolver_method: :resolve_sample_for_report do
        argument :rails_sample_id, String, required: false
        argument :snapshot_link_id, String, required: false
      end
    end

    def resolve_sample_for_report(rails_sample_id: nil, snapshot_link_id: nil)
      # A public snapshot-share viewer is unauthenticated (current_power is empty), so authorize via
      # the SnapshotLink and never let them edit. The normal (session) path is unchanged (SMP-1457).
      if snapshot_link_id.present?
        sample = snapshot_authorized_sample(rails_sample_id, snapshot_link_id)
        editable = false
      else
        sample = current_power.samples.find(rails_sample_id.to_i)
        editable = current_power.updatable_sample?(sample)
      end

      sample_info = sample.as_json(
        only: SamplesController::SAMPLE_DEFAULT_FIELDS,
        include: { project: { only: [:id, :name], methods: [:pinned_alignment_config] } }
      ).merge(
        "default_background_id" => sample.default_background_id,
        "default_pipeline_run_id" => sample.first_pipeline_run.present? ? sample.first_pipeline_run.id : nil,
        "editable" => editable,
        "pipeline_runs" => sample.pipeline_runs_info,
        "workflow_runs" => sample.workflow_runs_info
      ).as_json # uniform string keys + JSON-typed values (Times -> ISO strings)

      stringify_report_ids(sample_info)

      sample_info.merge("id" => rails_sample_id, "railsSampleId" => rails_sample_id)
    end

    private

    def stringify_report_ids(sample_info)
      Array(sample_info["pipeline_runs"]).each do |pr|
        pr["id"] = pr["id"].to_s unless pr["id"].nil?
      end
      Array(sample_info["workflow_runs"]).each do |wr|
        wr["id"] = wr["id"].to_s unless wr["id"].nil?
      end
      unless sample_info["default_pipeline_run_id"].nil?
        sample_info["default_pipeline_run_id"] = sample_info["default_pipeline_run_id"].to_s
      end
      if sample_info["project"] && !sample_info["project"]["id"].nil?
        sample_info["project"]["id"] = sample_info["project"]["id"].to_s
      end
    end
  end
end

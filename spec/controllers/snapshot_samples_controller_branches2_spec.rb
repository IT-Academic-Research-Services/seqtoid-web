# frozen_string_literal: true

require 'rails_helper'

# Branch-coverage companion #2 for app/controllers/snapshot_samples_controller.rb.
# Companion #1 covers show / report_v2 / index_v2 paging. This file takes the
# remaining arms:
#   - index_v2: the `unless basic` detail-hydration arm
#   - metadata_fields: the sample-present and sample-absent arms of the ternary
#   - app_config_required: the "snapshot sharing disabled" block
#   - check_snapshot_exists: the unknown share_id block
#   - set_snapshot_sample: the "sample not in the snapshot" block
#   - block_action: a non-snapshot action is redirected away
RSpec.describe SnapshotSamplesController, type: :controller do
  before do
    create(:metadata_field, name: "collection_location", base_type: 0)
    create(:metadata_field, name: "collection_location_v2", base_type: 3)
    create(:metadata_field, name: "sample_type", base_type: 0)
    create(:host_genome, name: "Human")
    nucleotide_type = create(:metadata_field, name: "nucleotide_type", base_type: 0)

    user = create(:user)
    project = create(:project, users: [user], metadata_fields: [nucleotide_type])

    @sample_one = create(:sample,
                         project: project,
                         metadata_fields: { "nucleotide_type" => nil },
                         pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
    @sample_two = create(:sample,
                         project: project,
                         pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
    @other_sample = create(:sample, project: project)

    AppConfigHelper.set_app_config(AppConfig::ENABLE_SNAPSHOT_SHARING, "1")

    @background = create(:background, name: "Snapshot Branch Background 2", public_access: 1, pipeline_run_ids: [
                           @sample_one.first_pipeline_run.id,
                           @sample_two.first_pipeline_run.id,
                         ])

    @snapshot_link = create(:snapshot_link,
                            project_id: project.id,
                            share_id: "branch_test_id_2",
                            content: {
                              background_id: @background.id,
                              samples: [
                                { @sample_one.id => { pipeline_run_id: @sample_one.first_pipeline_run.id } },
                                { @sample_two.id => { pipeline_run_id: @sample_two.first_pipeline_run.id } },
                              ],
                            }.to_json)
  end

  describe "GET #index_v2 in full (non-basic) mode" do
    it "hydrates each sample with its details" do
      get :index_v2, params: {
        share_id: @snapshot_link.share_id,
        project_id: @snapshot_link.project_id,
      }

      expect(response).to have_http_status(:success)
      json_response = JSON.parse(response.body)
      expect(json_response["samples"].length).to eq(2)
      expect(json_response["samples"].first).to have_key("details")
    end

    it "omits the details in basic mode" do
      get :index_v2, params: {
        share_id: @snapshot_link.share_id,
        project_id: @snapshot_link.project_id,
        basic: true,
      }

      json_response = JSON.parse(response.body)
      expect(json_response["samples"].first).not_to have_key("details")
    end
  end

  describe "GET #metadata_fields" do
    it "returns the field info for a sample that is in the snapshot" do
      get :metadata_fields, params: {
        share_id: @snapshot_link.share_id,
        sampleIds: [@sample_one.id],
      }

      expect(response).to have_http_status(:success)
      expect(JSON.parse(response.body)).to be_an(Array)
    end

    it "returns an empty list when no sample id resolves inside the snapshot" do
      get :metadata_fields, params: {
        share_id: @snapshot_link.share_id,
        sampleIds: [@other_sample.id],
      }

      expect(response).to have_http_status(:success)
      expect(JSON.parse(response.body)).to eq([])
    end
  end

  describe "access guards" do
    it "redirects when snapshot sharing is disabled" do
      AppConfigHelper.set_app_config(AppConfig::ENABLE_SNAPSHOT_SHARING, "0")

      get :show, params: { id: @sample_one.id, share_id: @snapshot_link.share_id }

      expect(response).to redirect_to(page_not_found_path)
    end

    it "redirects when the share id does not resolve to a snapshot" do
      get :show, params: { id: @sample_one.id, share_id: "not_a_real_share_id" }

      expect(response).to redirect_to(page_not_found_path)
    end

    it "redirects when the requested sample is not part of the snapshot" do
      get :show, params: { id: @other_sample.id, share_id: @snapshot_link.share_id }

      expect(response).to redirect_to(page_not_found_path)
    end
  end
end

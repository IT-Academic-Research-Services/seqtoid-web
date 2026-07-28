require 'rails_helper'

# Branch-coverage companion for app/controllers/snapshot_samples_controller.rb.
# The existing controller spec always passes an explicit background, always asks
# for listAllIds and never uses a limit or a deleted sample, so these arms are
# never taken:
#   - show: the `unless @sample.deleted_at.nil?` redirect
#   - report_v2: the "background param missing -> read it from the snapshot" arm
#   - index_v2: the explicit `limit` arm of the ternary
#   - index_v2: the falsy `listAllIds` arm of the trailing `if`
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

    AppConfigHelper.set_app_config(AppConfig::ENABLE_SNAPSHOT_SHARING, "1")

    @background = create(:background, name: "Snapshot Background", public_access: 1, pipeline_run_ids: [
                           @sample_one.first_pipeline_run.id,
                           @sample_two.first_pipeline_run.id,
                         ])

    @snapshot_link = create(:snapshot_link,
                            project_id: project.id,
                            share_id: "branch_test_id",
                            content: {
                              background_id: @background.id,
                              samples: [
                                { @sample_one.id => { pipeline_run_id: @sample_one.first_pipeline_run.id } },
                                { @sample_two.id => { pipeline_run_id: @sample_two.first_pipeline_run.id } },
                              ],
                            }.to_json)
  end

  describe "GET #show for a deleted sample" do
    it "redirects to page_not_found_path when the sample has been soft-deleted" do
      @sample_one.update!(deleted_at: Time.now.utc)

      get :show, params: { id: @sample_one.id, share_id: @snapshot_link.share_id }

      expect(response).to redirect_to(page_not_found_path)
    end

    it "does not redirect when the sample is not deleted" do
      get :show, params: { format: "json", id: @sample_one.id, share_id: @snapshot_link.share_id }

      expect(response).to have_http_status(:success)
    end
  end

  describe "GET #report_v2 without an explicit background param" do
    it "falls back to the background_id stored on the snapshot" do
      get :report_v2, params: { id: @sample_one.id, share_id: @snapshot_link.share_id }

      expect(response).to have_http_status(:success)
      expect(controller.params[:background].to_i).to eq(@background.id)
    end

    it "keeps an explicitly supplied background param" do
      get :report_v2, params: { id: @sample_one.id, background: @background.id, share_id: @snapshot_link.share_id }

      expect(response).to have_http_status(:success)
      expect(controller.params[:background].to_i).to eq(@background.id)
    end
  end

  describe "GET #index_v2 paging and id-listing arms" do
    it "honors an explicit limit and omits all_samples_ids when listAllIds is falsy" do
      get :index_v2, params: {
        share_id: @snapshot_link.share_id,
        project_id: @snapshot_link.project_id,
        limit: 1,
        basic: true,
      }

      expect(response).to have_http_status(:success)
      json_response = JSON.parse(response.body)
      expect(json_response["samples"].length).to eq(1)
      expect(json_response).not_to have_key("all_samples_ids")
    end

    it "defaults to the max page size and returns all ids when listAllIds is set" do
      get :index_v2, params: {
        share_id: @snapshot_link.share_id,
        project_id: @snapshot_link.project_id,
        listAllIds: true,
        basic: true,
      }

      expect(response).to have_http_status(:success)
      json_response = JSON.parse(response.body)
      expect(json_response["samples"].length).to eq(2)
      expect(json_response["all_samples_ids"]).to match_array([@sample_one.id, @sample_two.id])
    end

    it "applies the offset argument" do
      get :index_v2, params: {
        share_id: @snapshot_link.share_id,
        project_id: @snapshot_link.project_id,
        offset: 1,
        basic: true,
      }

      expect(response).to have_http_status(:success)
      json_response = JSON.parse(response.body)
      expect(json_response["samples"].length).to eq(1)
    end
  end
end

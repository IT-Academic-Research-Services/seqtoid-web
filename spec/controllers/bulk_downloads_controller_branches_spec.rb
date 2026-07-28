require "rails_helper"

# Companion branch sweep for BulkDownloadsController. The main controller spec
# covers create / consensus_genome_* / index / show / presigned_output_url and
# the token actions. The arms left untaken are:
#   - GET #types: the admin (no filtering) vs non-admin fork, the
#     required_allowed_feature check on both sides, the hide_in_creation_modal
#     reject, and the blank-workflow default.
#   - POST #sample_metadata: the happy path and the StandardError rescue.
#   - GET #index (admin): the searchBy and n narrowing gates, present and absent.
RSpec.describe BulkDownloadsController, type: :controller do
  create_users

  # These actions read MAX_OBJECTS_BULK_DOWNLOAD out of AppConfig; seed it here
  # so the file passes standalone rather than relying on a sibling spec.
  before do
    AppConfigHelper.set_app_config(AppConfig::MAX_OBJECTS_BULK_DOWNLOAD, 100)
  end

  describe "GET #types" do
    context "as a non-admin user" do
      before { sign_in @joe }

      it "hides feature-flagged types the user is not entitled to" do
        get :types, params: { workflow: WorkflowRun::WORKFLOW[:short_read_mngs] }, format: :json

        expect(response).to have_http_status(:ok)
        types = JSON.parse(response.body)
        gated = BulkDownloadTypesHelper.bulk_download_types.select { |t| t[:required_allowed_feature].present? }
        expect(gated).not_to be_empty
        gated.each do |t|
          expect(types.map { |x| x["type"] }).not_to include(t[:type])
        end
      end

      it "shows a feature-flagged type once the user has the feature" do
        gated = BulkDownloadTypesHelper.bulk_download_types.find do |t|
          t[:required_allowed_feature].present? &&
            !t[:hide_in_creation_modal] &&
            t[:workflows].include?(WorkflowRun::WORKFLOW[:short_read_mngs])
        end
        skip "no feature-gated short-read type to exercise" if gated.nil?

        @joe.update(allowed_features: [gated[:required_allowed_feature]].to_json)

        get :types, params: { workflow: WorkflowRun::WORKFLOW[:short_read_mngs] }, format: :json

        expect(JSON.parse(response.body).pluck("type")).to include(gated[:type])
      end

      it "never returns types marked hide_in_creation_modal" do
        get :types, format: :json

        returned = JSON.parse(response.body).pluck("type")
        hidden = BulkDownloadTypesHelper.bulk_download_types.select { |t| t[:hide_in_creation_modal] }
        expect(hidden).not_to be_empty
        hidden.each { |t| expect(returned).not_to include(t[:type]) }
      end

      it "defaults to the short-read mNGS workflow when none is supplied" do
        get :types, format: :json
        defaulted = JSON.parse(response.body).pluck("type")

        get :types, params: { workflow: WorkflowRun::WORKFLOW[:short_read_mngs] }, format: :json
        explicit = JSON.parse(response.body).pluck("type")

        expect(defaulted).to eq(explicit)
      end

      it "returns a different set for a different workflow" do
        get :types, params: { workflow: WorkflowRun::WORKFLOW[:consensus_genome] }, format: :json
        cg_types = JSON.parse(response.body).pluck("type")

        expect(response).to have_http_status(:ok)
        cg_types.each do |type_name|
          type = BulkDownloadTypesHelper.bulk_download_type(type_name)
          expect(type[:workflows]).to include(WorkflowRun::WORKFLOW[:consensus_genome])
        end
      end
    end

    context "as an admin user" do
      before { sign_in @admin }

      it "skips the entitlement filtering entirely" do
        get :types, params: { workflow: WorkflowRun::WORKFLOW[:short_read_mngs] }, format: :json
        admin_types = JSON.parse(response.body).pluck("type")

        # An admin sees every non-hidden short-read type, feature-gated or not,
        # even though @admin holds none of those allowed_features.
        expected = BulkDownloadTypesHelper.bulk_download_types.reject { |t| t[:hide_in_creation_modal] }
                                                              .select { |t| t[:workflows].include?(WorkflowRun::WORKFLOW[:short_read_mngs]) }
        gated = expected.select { |t| t[:required_allowed_feature].present? }

        expect(admin_types).to match_array(expected.pluck(:type))
        expect(gated).not_to be_empty
        expect(admin_types).to include(*gated.pluck(:type))
      end
    end
  end

  describe "POST #sample_metadata" do
    before { sign_in @joe }

    let(:project) { create(:project, users: [@joe]) }

    it "returns the metadata matrix for viewable samples" do
      sample = create(:sample, project: project, name: "Joes Sample")

      post :sample_metadata, params: { sample_ids: [sample.id] }, format: :json

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["sample_metadata"].first.first).to eq("sample_name")
      expect(body["sample_metadata"][1].first).to eq("Joes Sample")
    end

    it "renders the validation error when sample_ids is not an array" do
      post :sample_metadata, params: { sample_ids: "not-an-array" }, format: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["error"]).to eq(BulkDownloadsHelper::MISSING_SAMPLE_IDS_ERROR)
    end

    it "renders an error when the user cannot see one of the samples" do
      other_project = create(:project, users: [@admin])
      hidden = create(:sample, project: other_project)

      post :sample_metadata, params: { sample_ids: [hidden.id] }, format: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["error"]).to eq(BulkDownloadsHelper::SAMPLE_NO_PERMISSION_ERROR)
    end
  end

  describe "GET #index narrowing (admin only)" do
    let(:project) { create(:project, users: [@admin]) }

    def make_download(user)
      sample = create(:sample, project: project,
                               pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
      create(:bulk_download, user: user,
                             pipeline_run_ids: [sample.first_pipeline_run.id],
                             download_type: "unmapped_reads")
    end

    it "filters by user name/email when searchBy is present" do
      sign_in @admin
      joes = make_download(@joe)
      make_download(@admin)

      get :index, params: { searchBy: @joe.email }, format: :json

      ids = JSON.parse(response.body).pluck("id")
      expect(ids).to eq([joes.id])
    end

    it "caps the result count when n is present" do
      sign_in @admin
      make_download(@admin)
      make_download(@admin)

      get :index, params: { n: 1 }, format: :json

      expect(JSON.parse(response.body).length).to eq(1)
    end

    it "returns everything when neither narrowing param is given" do
      sign_in @admin
      make_download(@joe)
      make_download(@admin)

      get :index, format: :json

      expect(JSON.parse(response.body).length).to eq(2)
    end

    it "ignores the narrowing params for a non-admin" do
      sign_in @joe
      joe_project = create(:project, users: [@joe])
      sample = create(:sample, project: joe_project,
                               pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
      create(:bulk_download, user: @joe, pipeline_run_ids: [sample.first_pipeline_run.id], download_type: "unmapped_reads")
      sample2 = create(:sample, project: joe_project,
                                pipeline_runs_data: [{ finalized: 1, job_status: PipelineRun::STATUS_CHECKED }])
      create(:bulk_download, user: @joe, pipeline_run_ids: [sample2.first_pipeline_run.id], download_type: "unmapped_reads")

      get :index, params: { n: 1, searchBy: "nobody" }, format: :json

      # the admin-only gate was skipped, so both downloads still come back
      expect(JSON.parse(response.body).length).to eq(2)
    end
  end
end

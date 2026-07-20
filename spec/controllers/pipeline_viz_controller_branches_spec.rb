require 'rails_helper'

# Branch-coverage spec for PipelineVizController#show.
#
# The existing pipeline_viz_controller_spec.rb only drives the step_function? happy
# path (+ the not-found / access branches). This targets the execution-strategy fork
# and the error handling the happy path never reaches:
#   * the "no execution strategy" else arm, and its admin vs non-admin render
#   * the rescue arm, and its admin (error object) vs non-admin (hidden) render
#   * the directed_acyclic_graph? elsif arm
#
# TEST-ONLY. Mutation-checked: each example asserts a status/body that flips if the
# targeted branch is inverted or removed.
RSpec.describe PipelineVizController, type: :controller do
  create_users

  let(:fake_sfn_execution_arn) { CommonStubConstants::FAKE_SFN_EXECUTION_ARN }

  # A viewable sample carrying a single pipeline run. The execution-strategy predicates
  # are stubbed per-context, so the committed run data only needs to exist.
  def make_sample
    project = create(:public_project)
    create(
      :sample,
      project: project,
      pipeline_runs_data: [{ sfn_execution_arn: fake_sfn_execution_arn }]
    )
  end

  context "when the pipeline run has NO execution strategy (else arm)" do
    before do
      allow_any_instance_of(PipelineRun).to receive(:step_function?).and_return(false)
      allow_any_instance_of(PipelineRun).to receive(:directed_acyclic_graph?).and_return(false)
    end

    it "surfaces the no-execution-strategy detail to an admin (500)" do
      sign_in @admin
      sample = make_sample
      get :show, params: { format: "json", sample_id: sample.id }

      expect(response).to have_http_status(:internal_server_error)
      expect(JSON.parse(response.body)["status"]).to eq(PipelineVizController::STATUS_NO_EXECUTION_STRATEGY)
    end

    it "hides the strategy detail behind the generic error for a non-admin (500)" do
      sign_in @joe
      sample = make_sample
      get :show, params: { format: "json", sample_id: sample.id }

      expect(response).to have_http_status(:internal_server_error)
      expect(JSON.parse(response.body)["status"]).to eq(PipelineVizController::STATUS_OTHER_ERROR)
    end
  end

  context "when retrieving the pipeline data raises (rescue arm)" do
    before do
      allow_any_instance_of(PipelineRun).to receive(:step_function?).and_return(true)
      allow_any_instance_of(PipelineRun).to receive(:call_pipeline_data_service).and_raise(StandardError, "boom")
    end

    it "includes the raw error object for an admin (500)" do
      sign_in @admin
      sample = make_sample
      get :show, params: { format: "json", sample_id: sample.id }

      expect(response).to have_http_status(:internal_server_error)
      body = JSON.parse(response.body)
      expect(body["status"]).to eq(PipelineVizController::STATUS_OTHER_ERROR)
      expect(body).to have_key("error")
    end

    it "omits the error object for a non-admin (500)" do
      sign_in @joe
      sample = make_sample
      get :show, params: { format: "json", sample_id: sample.id }

      expect(response).to have_http_status(:internal_server_error)
      body = JSON.parse(response.body)
      expect(body["status"]).to eq(PipelineVizController::STATUS_OTHER_ERROR)
      expect(body).not_to have_key("error")
    end
  end

  context "when the pipeline run uses the directed-acyclic-graph strategy (elsif arm)" do
    before do
      allow_any_instance_of(PipelineRun).to receive(:step_function?).and_return(false)
      allow_any_instance_of(PipelineRun).to receive(:directed_acyclic_graph?).and_return(true)
      allow(RetrievePipelineVizGraphDataService).to receive(:call)
        .and_return(stages: [], edges: [], status: "inProgress")
    end

    it "renders the graph produced by RetrievePipelineVizGraphDataService" do
      sign_in @admin
      sample = make_sample
      get :show, params: { format: "json", sample_id: sample.id }

      expect(response).to have_http_status(:success)
      expect(RetrievePipelineVizGraphDataService).to have_received(:call)
    end
  end
end

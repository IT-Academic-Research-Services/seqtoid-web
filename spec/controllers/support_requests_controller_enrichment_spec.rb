# frozen_string_literal: true

require "rails_helper"

# Covers the Phase 2 async-enrichment enqueue arm of SupportRequestsController#create:
# a failed run + the lambda enabled -> SupportEnrichmentJob is enqueued; disabled -> not.
RSpec.describe SupportRequestsController, type: :controller do
  create_users

  before { sign_in @joe }

  let(:project) { create(:project, users: [@joe]) }
  let(:sample) { create(:sample, project: project, user: @joe, initial_workflow: "short-read-mngs") }
  let!(:run) do
    create(:pipeline_run,
           sample: sample,
           job_status: "1.Host Filtering-FAILED",
           finalized: 1,
           sfn_execution_arn: "arn:aws:states:us-west-2:1:execution:x")
  end

  let(:run_context) { { sample_id: sample.id, run_id: run.id, workflow: "short-read-mngs" } }

  it "enqueues SupportEnrichmentJob for a failed run when the lambda is enabled" do
    allow(SupportEnrichmentLambda).to receive(:enabled?).and_return(true)
    expect(Resque).to receive(:enqueue).with(
      SupportEnrichmentJob, kind_of(String), "arn:aws:states:us-west-2:1:execution:x", "pipeline_run", run.id
    )

    post :create, params: { description: "help", run_context: run_context }

    expect(response).to have_http_status(:created)
  end

  it "does not enqueue when the lambda is disabled (inert until deployed)" do
    allow(SupportEnrichmentLambda).to receive(:enabled?).and_return(false)
    expect(Resque).not_to receive(:enqueue)

    post :create, params: { description: "help", run_context: run_context }

    expect(response).to have_http_status(:created)
  end
end

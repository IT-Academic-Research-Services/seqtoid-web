require 'rails_helper'

# Branch-coverage spec for SupportRequestsController.
#
# Targets branches the existing support_requests_controller_spec.rb does NOT exercise:
#   * the create rescue -> 500 error path
#   * query_action_log_steps rescue -> nil (query raises but submit still succeeds)
#   * build_journey rescue -> nil (journey build raises but submit still succeeds)
#   * match_runbook upload + auth arms of the RUNBOOK_CATALOG
#   * build_summary "Not in a project" suppression + route-absent arm
#   * summarize_action_trail: nil-action skip and all-nil -> nil (no "Recent steps")
#   * sanitized_diagnostics: string truncation vs non-string passthrough
#
# TEST-ONLY. Mutation-checked: each example asserts an observable that flips if the
# targeted branch is inverted or removed.
RSpec.describe SupportRequestsController, type: :controller do
  create_users

  before { sign_in @joe }

  # Capture the operator-only payload handed to LogUtil.log_message.
  def capture_payload
    captured = nil
    allow(LogUtil).to receive(:log_message) { |_msg, **payload| captured = payload }
    yield
    captured
  end

  describe "POST #create error path (fail-soft -> 500)" do
    it "returns 500 and does not raise when recording the payload blows up" do
      # log_message raising is caught by the create rescue; if the rescue were
      # removed this would propagate instead of rendering a 500.
      allow(LogUtil).to receive(:log_message).and_raise(StandardError, "sink down")
      allow(LogUtil).to receive(:log_error)

      post :create, params: { description: "boom" }

      expect(response).to have_http_status(:internal_server_error)
      expect(JSON.parse(response.body)["error"]).to eq("Unable to record support request")
    end
  end

  describe "action-log query failure (CZID-472 fail-soft)" do
    before { stub_const("ENV", ENV.to_hash.merge("SUPPORT_LOG_GROUP" => "/seqtoid/support")) }

    it "swallows a query raise: action_log_steps nil and the submit still succeeds (201)" do
      allow(SupportActionLogQuery).to receive(:recent_steps).and_raise(StandardError, "cw down")
      allow(LogUtil).to receive(:log_error)

      payload = capture_payload { post :create, params: { description: "x" } }

      # If the query rescue were removed, the raise would hit the create rescue -> 500.
      expect(response).to have_http_status(:created)
      expect(payload[:action_log_steps]).to be_nil
    end
  end

  describe "journey build failure (CZID-722 fail-soft)" do
    before { stub_const("ENV", ENV.to_hash.merge("SUPPORT_LOG_GROUP" => "/seqtoid/support")) }

    it "swallows a journey-build raise: journey nil and the submit still succeeds (201)" do
      steps = [{ at: "2026-07-09T10:00:00Z", action: "project.create", outcome: "ok" }]
      allow(SupportActionLogQuery).to receive(:recent_steps).and_return(steps)
      allow(SupportJourney).to receive(:from_steps).and_raise(StandardError, "bad trail")
      allow(LogUtil).to receive(:log_error)

      payload = capture_payload { post :create, params: { description: "x" } }

      expect(response).to have_http_status(:created)
      expect(payload[:journey]).to be_nil
      # action_log_steps still populated -- only the journey transform failed.
      expect(payload[:action_log_steps]).to eq(steps)
    end
  end

  describe "match_runbook catalog arms" do
    it "matches the upload_failure runbook on an upload/s3 error" do
      payload = capture_payload do
        post :create, params: { quick_report: { errorName: "S3 resumable upload failed" } }
      end
      expect(payload[:runbook][:id]).to eq("upload_failure")
    end

    it "matches the auth_login_failure runbook on a 401/unauthorized error" do
      payload = capture_payload do
        post :create, params: { quick_report: { errorName: "401 unauthorized token" } }
      end
      expect(payload[:runbook][:id]).to eq("auth_login_failure")
    end
  end

  describe "build_summary project + route arms" do
    it "does NOT fold the sentinel 'Not in a project' into the summary" do
      payload = capture_payload do
        post :create, params: {
          quick_report: { errorName: "oops", task: "Home", project: "Not in a project" },
        }
      end
      expect(payload[:summary]).not_to include("in Not in a project")
      expect(payload[:summary]).to include("oops")
    end

    it "omits the route clause when no route is present" do
      payload = capture_payload do
        post :create, params: { quick_report: { errorName: "oops", task: "Home" } }
      end
      expect(payload[:summary]).not_to include("route:")
    end
  end

  describe "summarize_action_trail arms" do
    before { stub_const("ENV", ENV.to_hash.merge("SUPPORT_LOG_GROUP" => "/seqtoid/support")) }

    it "skips steps whose action is nil and keeps the rest in the trail" do
      steps = [
        { at: "t0", action: nil, outcome: "ok" },
        { at: "t1", action: "sample.upload", outcome: "ok" },
      ]
      allow(SupportActionLogQuery).to receive(:recent_steps).and_return(steps)

      payload = capture_payload { post :create, params: { description: "x" } }
      expect(payload[:summary]).to include("Recent steps: sample.upload.")
    end

    it "produces NO 'Recent steps' tail when every step lacks an action" do
      steps = [{ at: "t0", action: nil, outcome: "ok" }, { at: "t1", action: nil, outcome: "error" }]
      allow(SupportActionLogQuery).to receive(:recent_steps).and_return(steps)

      payload = capture_payload { post :create, params: { description: "x" } }
      expect(payload[:summary]).not_to include("Recent steps:")
    end
  end

  describe "sanitized_diagnostics arms" do
    it "truncates long string values but passes non-string values through untouched" do
      payload = capture_payload do
        # as: :json so the integer value stays an integer (the non-string arm of the
        # transform_values ternary); through form params everything arrives as a String.
        post :create, params: {
          description: "x",
          diagnostics: { route: "y" * 3000, retries: 5 },
        }, as: :json
      end
      diag = payload[:diagnostics]
      expect(diag[:route].length).to be <= 2000
      expect(diag[:retries]).to eq(5)
    end

    it "yields an empty hash when diagnostics is absent (blank -> {})" do
      payload = capture_payload { post :create, params: { description: "x" } }
      expect(payload[:diagnostics]).to eq({})
    end
  end
end

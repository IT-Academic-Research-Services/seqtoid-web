require 'rails_helper'

RSpec.describe SupportRequestsController, type: :controller do
  context "when the user is signed in" do
    before do
      @user = create(:user)
      sign_in @user
    end

    describe "POST #create" do
      let(:valid_params) do
        {
          description: "The report page will not load for my sample.",
          quick_report: {
            errorName: "TypeError: cannot read property 'foo' of undefined",
            task: "Bulk download",
            project: "Project 7",
            accountName: "Test User",
          },
          diagnostics: {
            release: "abc1234",
            environment: "test",
            route: "/bulk_downloads",
            url: "/bulk_downloads",
            userAgent: "Mozilla/5.0",
          },
        }
      end

      it "returns 201 created and records the rich, support-side payload" do
        expect(LogUtil).to receive(:log_message).with(
          a_string_matching(/Support request from user #{@user.id}/),
          hash_including(
            event: "support_request",
            user_id: @user.id,
            user_email: @user.email,
            # user-facing quick report fields
            error: "TypeError: cannot read property 'foo' of undefined",
            task: "Bulk download",
            project: "Project 7",
            account_name: "Test User",
          )
        )

        post :create, params: valid_params

        expect(response).to have_http_status(:created)
        json_response = JSON.parse(response.body)
        expect(json_response["status"]).to eq("ok")
        expect(json_response["correlation_id"]).to be_present
      end

      it "attaches a correlation id, summary, matched runbook, and log deep-links" do
        captured = nil
        allow(LogUtil).to receive(:log_message) do |_msg, **payload|
          captured = payload
        end

        post :create, params: valid_params

        expect(captured[:correlation_id]).to be_present
        expect(captured[:summary]).to include("Bulk download")
        # A bulk-download error should match the bulk_download runbook.
        expect(captured[:runbook][:id]).to eq("bulk_download_failure")
        expect(captured[:runbook][:runbook]).to be_present
        # Log deep-links are constructed and filtered to this session/user.
        expect(captured[:log_links][:cloudwatch_logs_insights]).to include("cloudwatch")
        expect(captured[:log_links][:otel_dashboard]).to include(captured[:correlation_id])
        # (CZID-472) With no SUPPORT_LOG_GROUP configured (test env) the live
        # action-log query is inert, so no synthesized steps -- but the operator
        # still gets a one-click deep-link to the raw per-user action-log trail.
        expect(captured[:action_log_steps]).to be_nil
        expect(captured[:log_links][:otel_action_log]).to include("logs-insights")
        # (CZID-722) With no trail to structure, the journey block is nil too, so the
        # payload just omits it -- same inert contract as action_log_steps.
        expect(captured[:journey]).to be_nil
      end

      context "when SUPPORT_LOG_GROUP is configured and the action log has entries" do
        before do
          stub_const("ENV", ENV.to_hash.merge("SUPPORT_LOG_GROUP" => "/seqtoid/support"))
        end

        it "attaches the parsed action-log steps and folds them into the summary" do
          steps = [
            { at: "2026-07-09T10:00:00Z", action: "project.create", outcome: "ok" },
            { at: "2026-07-09T10:01:00Z", action: "bulk_download.create", outcome: "error", error_class: "RuntimeError" },
          ]
          allow(SupportActionLogQuery).to receive(:recent_steps).and_return(steps)

          captured = nil
          allow(LogUtil).to receive(:log_message) { |_msg, **payload| captured = payload }

          post :create, params: valid_params

          expect(captured[:action_log_steps]).to eq(steps)
          expect(captured[:summary]).to include("Recent steps:")
          expect(captured[:summary]).to include("bulk_download.create (error)")
        end

        it "attaches the structured customer journey (CZID-722) built from the same steps" do
          steps = [
            { at: "2026-07-09T10:00:00Z", action: "sample.bulk_upload", outcome: "ok" },
            { at: "2026-07-09T10:05:00Z", action: "bulk_download.create", outcome: "error", error_class: "RuntimeError" },
          ]
          allow(SupportActionLogQuery).to receive(:recent_steps).and_return(steps)

          captured = nil
          allow(LogUtil).to receive(:log_message) { |_msg, **payload| captured = payload }

          post :create, params: valid_params

          journey = captured[:journey]
          expect(journey[:step_count]).to eq(2)
          expect(journey[:session_count]).to eq(1)
          # The two steps are a completed sample_to_download funnel that errored at
          # the download stage -- the structural "what led to the ticket".
          funnel = journey[:funnels].find { |f| f[:name] == "sample_to_download" }
          expect(funnel[:completed]).to be(true)
          expect(funnel[:errored_at]).to eq("bulk_download.create")
        end
      end

      it "falls back to a generic runbook when nothing matches" do
        captured = nil
        allow(LogUtil).to receive(:log_message) do |_msg, **payload|
          captured = payload
        end

        post :create, params: {
          quick_report: { errorName: "Something odd", task: "Home" },
          diagnostics: { route: "/home" },
        }

        expect(captured[:runbook][:id]).to eq("generic_triage")
      end

      it "succeeds when only a description is provided (quick report / diagnostics optional)" do
        post :create, params: { description: "Something is broken." }
        expect(response).to have_http_status(:created)
      end

      it "succeeds with an empty description (report without free-text)" do
        post :create, params: { quick_report: { task: "Home" } }
        expect(response).to have_http_status(:created)
      end
    end
  end

  context "when the user is not signed in" do
    describe "POST #create" do
      it "does not record the request and redirects to login" do
        expect(LogUtil).not_to receive(:log_message)
        post :create, params: { description: "hello" }
        expect(response).to have_http_status(:redirect)
      end
    end
  end
end

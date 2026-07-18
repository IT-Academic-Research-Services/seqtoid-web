require "rails_helper"

# CZID-722 (Phase 2b). The admin-only data API that serves the aggregate product-usage
# overview. These specs pin the two things that matter for an endpoint the exposed
# dashboard will call: (1) it is genuinely admin-gated -- a non-admin, and an
# unauthenticated caller, cannot read it; (2) it shapes ProductUsageAnalytics' result
# into a stable, available-flagged JSON, including the inert (no log group) case. The
# rollup itself is covered by product_usage_analytics_spec; here it is stubbed.
RSpec.describe ProductUsageAnalyticsController, type: :controller do
  describe "GET #index" do
    context "as a non-admin user" do
      before { sign_in create(:user) }

      it "does not serve analytics -- admin_required redirects it away" do
        expect(ProductUsageAnalytics).not_to receive(:overview)
        get :index
        expect(response).to have_http_status(:redirect)
      end
    end

    context "when not signed in" do
      it "does not serve analytics" do
        expect(ProductUsageAnalytics).not_to receive(:overview)
        get :index
        expect(response).to have_http_status(:redirect)
      end
    end

    context "as an admin" do
      before { sign_in create(:admin) }

      it "returns the aggregate overview as available JSON" do
        overview = {
          window: { start: 1, end: 2 },
          event_count: 3,
          active_users: 2,
          truncated: false,
          actions: [{ action: "project.create", count: 3, error_count: 0, error_rate: 0.0 }],
        }
        allow(ProductUsageAnalytics).to receive(:overview).and_return(overview)

        get :index

        expect(response).to have_http_status(:ok)
        body = JSON.parse(response.body)
        expect(body["available"]).to be(true)
        expect(body["event_count"]).to eq(3)
        expect(body["actions"].first["action"]).to eq("project.create")
      end

      it "reports available:false (not a 500) when analytics is inert / unconfigured" do
        allow(ProductUsageAnalytics).to receive(:overview).and_return(nil)

        get :index

        expect(response).to have_http_status(:ok)
        body = JSON.parse(response.body)
        expect(body["available"]).to be(false)
      end

      it "defaults the window to 7 days and clamps an over-large request to 90" do
        expect(ProductUsageAnalytics).to receive(:overview).twice.and_return(nil)

        get :index
        expect(JSON.parse(response.body)["window_days"]).to eq(7)

        get :index, params: { days: 9999 }
        expect(JSON.parse(response.body)["window_days"]).to eq(90)
      end
    end
  end
end

require "rails_helper"

# Admin feature-flags page (FeatureFlagsController). Gated by login_required + admin_required (non-admins
# are redirected to root). Every change needs a confirmation re-post (confirmed=1) and is logged.
RSpec.describe "Feature flags admin", type: :request do
  create_users

  def launched
    AppConfigHelper.get_json_app_config(AppConfig::LAUNCHED_FEATURES, [])
  end

  describe "authorization" do
    it "redirects a logged-out visitor" do
      get "/admin/feature_flags"
      expect(response).to have_http_status(:found)

      post "/admin/feature_flags/global", params: { name: "AMR", state: "on", confirmed: "1" }
      expect(response).to have_http_status(:found)
      expect(launched).to eq([])
    end

    it "redirects a signed-in non-admin to root and changes nothing" do
      sign_in @joe

      get "/admin/feature_flags"
      expect(response).to redirect_to(root_path)

      post "/admin/feature_flags/global", params: { name: "AMR", state: "on", confirmed: "1" }
      expect(response).to redirect_to(root_path)
      post "/admin/feature_flags/user", params: { name: "AMR", email: @joe.email, op: "add", confirmed: "1" }
      expect(response).to redirect_to(root_path)

      expect(launched).to eq([])
      expect(@joe.reload.allowed_feature?("AMR")).to be(false)
      expect(FeatureFlagEvent.count).to eq(0)
    end
  end

  describe "GET /admin/feature_flags" do
    it "lists registry, launched, group and per-user flags with holders and the change log" do
      sign_in @admin
      Feature.enable("launched_only", by: @admin)
      Feature.enable_for("annotation", @joe, by: @admin)
      Feature.enable_for_group("group_only", "beta_testers", by: @admin)
      Feature.add_to_group(@joe.email, "beta_testers", by: @admin)

      get "/admin/feature_flags"

      expect(response).to have_http_status(:ok)
      body = response.body
      expect(body).to include(*Feature::REGISTRY.keys, "launched_only", "group_only")
      expect(body).to include(@joe.email)
      expect(body).to include("LAUNCHED")
      expect(body).to include("feature_flag_events_table", "add_member", @admin.email)
    end
  end

  describe "POST /admin/feature_flags/global" do
    before { sign_in @admin }

    it "renders a confirmation and changes nothing without confirmed=1" do
      post "/admin/feature_flags/global", params: { name: "AMR", state: "on" }

      expect(response).to have_http_status(:ok)
      expect(response.body).to include("Launch AMR for ALL users", "confirmed")
      expect(launched).to eq([])
      expect(FeatureFlagEvent.count).to eq(0)
    end

    it "launches and un-launches once confirmed, and logs the admin" do
      post "/admin/feature_flags/global", params: { name: "AMR", state: "on", confirmed: "1" }
      expect(response).to redirect_to(admin_feature_flags_path)
      expect(launched).to eq(["AMR"])
      expect(FeatureFlagEvent.last).to have_attributes(feature: "AMR", action: "enable", scope: "global", actor_user_id: @admin.id)

      post "/admin/feature_flags/global", params: { name: "AMR", state: "off", confirmed: "1" }
      expect(launched).to eq([])
    end

    it "rejects a malformed flag name" do
      post "/admin/feature_flags/global", params: { name: "bad name<script>", state: "on", confirmed: "1" }

      expect(response).to redirect_to(admin_feature_flags_path)
      expect(flash[:alert]).to eq("Invalid flag name.")
      expect(launched).to eq([])
    end
  end

  describe "POST /admin/feature_flags/user" do
    before { sign_in @admin }

    it "asks for confirmation, then grants and revokes by email" do
      post "/admin/feature_flags/user", params: { name: "annotation", email: @joe.email.upcase, op: "add" }
      expect(response.body).to include("Grant annotation to #{@joe.email}")
      expect(@joe.reload.allowed_feature?("annotation")).to be(false)

      post "/admin/feature_flags/user", params: { name: "annotation", email: @joe.email, op: "add", confirmed: "1" }
      expect(response).to redirect_to(admin_feature_flags_path)
      expect(@joe.reload.allowed_feature?("annotation")).to be(true)
      expect(FeatureFlagEvent.last).to have_attributes(scope: "user", target_user_id: @joe.id, actor_user_id: @admin.id)

      post "/admin/feature_flags/user", params: { name: "annotation", email: @joe.email, op: "remove", confirmed: "1" }
      expect(@joe.reload.allowed_feature?("annotation")).to be(false)
    end

    it "reports an unknown email without changing anything" do
      post "/admin/feature_flags/user", params: { name: "annotation", email: "ghost@example.org", op: "add", confirmed: "1" }

      expect(response).to redirect_to(admin_feature_flags_path)
      expect(flash[:alert]).to include("ghost@example.org")
      expect(FeatureFlagEvent.count).to eq(0)
    end
  end
end

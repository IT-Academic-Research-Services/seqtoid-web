require "rails_helper"

# Second-wave branch coverage for HomeController#landing. The other home_controller specs
# only drive the banner app-config arms; the hard-coded 2018 launch-bulletin window inside
# the `else` of SHOW_LANDING_VIDEO_BANNER is only ever evaluated with "now" far outside it,
# so the arm that turns the bulletin on by date has never run. These examples pin the clock
# on either side of that window.
RSpec.describe HomeController, type: :controller do
  before do
    # Self-contained: the action reads three app configs, and a missing one must not be
    # inherited from whatever a sibling spec happened to seed.
    create(:app_config, key: AppConfig::SHOW_LANDING_VIDEO_BANNER, value: "0")
    create(:app_config, key: AppConfig::SHOW_ANNOUNCEMENT_BANNER, value: "0")
    create(:app_config, key: AppConfig::SHOW_LANDING_PUBLIC_SITE_BANNER, value: "0")
  end

  describe "GET #landing inside the hard-coded bulletin window" do
    it "shows the bulletin when now falls between the launch start and end times" do
      travel_to(Time.utc(2018, 11, 1, 12, 0, 0)) do
        get :landing
      end

      expect(response).to have_http_status(:ok)
      expect(assigns(:show_bulletin)).to be(true)
      expect(assigns(:show_announcement_banner)).to be(false)
      expect(assigns(:show_public_site)).to be(false)
    end

    it "leaves the bulletin off once the window has closed" do
      travel_to(Time.utc(2019, 1, 1, 12, 0, 0)) do
        get :landing
      end

      expect(assigns(:show_bulletin)).to be(false)
    end

    it "leaves the bulletin off before the window opens" do
      travel_to(Time.utc(2018, 1, 1, 12, 0, 0)) do
        get :landing
      end

      expect(assigns(:show_bulletin)).to be(false)
    end
  end
end

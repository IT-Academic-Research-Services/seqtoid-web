require "rails_helper"

# The dev-pin banner is server-rendered in the application layout, so it is in the HTML before the React
# app loads -- for logged-out and logged-in pages alike -- and absent unless DEV_PIN_KIND is set.
RSpec.describe "Dev pin banner", type: :request do
  create_users

  def with_pin(env, &block)
    vars = { "DEV_PIN_KIND" => nil, "DEV_PIN_HOLDER" => nil, "DEV_PIN_EXPIRES_AT" => nil, "DEV_PIN_RC" => nil }.merge(env)
    ClimateControl.modify(vars, &block)
  end

  it "renders nothing without pin env vars" do
    with_pin({}) do
      get "/privacy"
      expect(response).to have_http_status(:ok)
      expect(response.body).not_to include("dev-pin-banner")
    end
  end

  it "renders nothing for kind none" do
    with_pin("DEV_PIN_KIND" => "none", "DEV_PIN_HOLDER" => "jsims") do
      get "/privacy"
      expect(response.body).not_to include("dev-pin-banner")
    end
  end

  it "shows the lease holder and expiry on a logged-out page" do
    with_pin("DEV_PIN_KIND" => "lease", "DEV_PIN_HOLDER" => "jsims", "DEV_PIN_EXPIRES_AT" => "2026-11-10T22:00:00Z") do
      get "/privacy"
      body = response.body
      expect(body).to include("dev-pin-banner")
      expect(body).to include("dev is running <strong>jsims</strong>'s branch build")
      expect(body).to include('datetime="2026-11-10T22:00:00Z"', "2026-11-10 22:00 UTC")
      expect(body).to include("results may differ from main")
    end
  end

  it "shows the release candidate on a logged-in page" do
    sign_in @joe
    with_pin("DEV_PIN_KIND" => "rc", "DEV_PIN_RC" => "rc-2026-11-11") do
      get "/my_data"
      expect(response.body).to include("dev is frozen on release candidate <strong>rc-2026-11-11</strong> for testing")
    end
  end

  it "escapes the holder" do
    with_pin("DEV_PIN_KIND" => "lease", "DEV_PIN_HOLDER" => "<script>x</script>") do
      get "/privacy"
      expect(response.body).not_to include("<script>x</script>")
      expect(response.body).to include("&lt;script&gt;x&lt;/script&gt;")
    end
  end
end

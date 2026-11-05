require 'rails_helper'

# The standalone device-location check (GeoComply staging test). Proves it is INERT when off, touches only
# the users listed in DEVICE_LOCATION_CHECK_USERS, and is fail-closed for them: only a current, verified,
# unexpired attestation from the same IP lets an in-scope user through. It needs NO export-control clearance.
RSpec.describe ExportControlDeviceLocationGate, type: :controller do
  controller(ApplicationController) do
    include ExportControlDeviceLocationGate
    before_action :require_device_location_check

    def index
      render plain: "ok"
    end
  end

  before do
    routes.draw { get "anonymous/index" => "anonymous#index" }
  end

  let(:user) { create(:user) }
  let(:ip) { "0.0.0.0" } # request.remote_ip in controller specs

  def set_config(key, value)
    AppConfigHelper.set_app_config(key, value)
  end

  def enable_check(users)
    set_config(AppConfig::ENABLE_DEVICE_LOCATION_CHECK, "1")
    set_config(AppConfig::DEVICE_LOCATION_CHECK_USERS, users)
  end

  describe "when the flag is OFF (default)" do
    it "is INERT even for a listed user with no attestation" do
      set_config(AppConfig::DEVICE_LOCATION_CHECK_USERS, [user.id].to_json)
      sign_in user
      get :index
      expect(response).to have_http_status(:ok)
    end
  end

  describe "when the flag is ON" do
    it "does nothing when the user list is unset" do
      set_config(AppConfig::ENABLE_DEVICE_LOCATION_CHECK, "1")
      sign_in user
      get :index
      expect(response).to have_http_status(:ok)
    end

    it "does nothing when the user list is not a JSON array" do
      enable_check("not json")
      sign_in user
      get :index
      expect(response).to have_http_status(:ok)
    end

    it "leaves users who are not listed alone" do
      enable_check([create(:user).id].to_json)
      sign_in user
      get :index
      expect(response).to have_http_status(:ok)
    end

    it "does not need an export-control clearance (independent of Layer 3)" do
      enable_check([user.id].to_json)
      create(:device_location_attestation, user: user, ip_address: ip)
      sign_in user
      get :index
      expect(response).to have_http_status(:ok)
    end

    {
      "user id" => ->(u) { [u.id] },
      "User:<id> string" => ->(u) { ["User:#{u.id}"] },
      "email (any case)" => ->(u) { [u.email.upcase] },
      "wildcard" => ->(_u) { ["*"] },
    }.each do |label, entries|
      context "user listed by #{label}" do
        before do
          enable_check(entries.call(user).to_json)
          sign_in user
        end

        it "REDIRECTS an HTML request with no attestation to the attestation page" do
          get :index
          expect(response).to redirect_to(new_device_location_attestation_path)
        end

        it "returns 403 for a JSON request with no attestation" do
          get :index, format: :json
          expect(response).to have_http_status(:forbidden)
        end
      end
    end

    context "listed user" do
      before do
        enable_check([user.id].to_json)
        sign_in user
      end

      it "ALLOWS with a current verified attestation from the same IP" do
        create(:device_location_attestation, user: user, ip_address: ip)
        get :index
        expect(response).to have_http_status(:ok)
      end

      it "DENIES a failed attestation" do
        create(:device_location_attestation, :failed, user: user, ip_address: ip)
        get :index
        expect(response).to redirect_to(new_device_location_attestation_path)
      end

      it "DENIES an expired attestation" do
        create(:device_location_attestation, user: user, ip_address: ip,
                                             created_at: (DeviceLocationAttestation::DEFAULT_MAX_AGE_MINUTES + 1).minutes.ago)
        get :index
        expect(response).to redirect_to(new_device_location_attestation_path)
      end

      it "DENIES an attestation made from a different IP" do
        create(:device_location_attestation, user: user, ip_address: "203.0.113.99")
        get :index
        expect(response).to redirect_to(new_device_location_attestation_path)
      end

      it "ALLOWS a different IP when the IP re-check is turned off" do
        set_config(AppConfig::DEVICE_LOCATION_RECHECK_ON_IP_CHANGE, "0")
        create(:device_location_attestation, user: user, ip_address: "203.0.113.99")
        get :index
        expect(response).to have_http_status(:ok)
      end
    end
  end
end

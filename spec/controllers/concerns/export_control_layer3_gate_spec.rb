require 'rails_helper'

# CZID-285/286 — the Layer 3 fail-closed gate, exercised through a real before_action on an anonymous
# controller. This is the load-bearing test: it proves the DENY MATRIX (nil user / no clearance /
# screening hit/pending / stale / device-attestation-required-but-missing all DENY) and that the ALLOW
# path is reachable ONLY on an affirmative current (clear screen) clearance. It also proves the gate is
# INERT when the dark flag is OFF. Approval is attestation + denied-party screening, with NO document-IDV.
RSpec.describe ExportControlLayer3Gate, type: :controller do
  controller(ApplicationController) do
    include ExportControlLayer3Gate
    before_action :require_export_control_layer3

    def index
      render plain: "ok"
    end
  end

  before do
    # Route the anonymous controller's #index (test-only route).
    routes.draw { get "anonymous/index" => "anonymous#index" }
  end

  let(:user) { create(:user) }

  def enable_layer3
    AppConfigHelper.set_app_config(AppConfig::ENABLE_EXPORT_CONTROL_LAYER3, "1")
  end

  def enable_device_attestation
    AppConfigHelper.set_app_config(AppConfig::ENABLE_EXPORT_CONTROL_DEVICE_ATTESTATION, "1")
  end

  describe "when the dark flag is OFF (default)" do
    it "is INERT — allows through even with no clearance" do
      sign_in user
      get :index
      expect(response).to have_http_status(:ok)
    end
  end

  describe "when Layer 3 enforcement is ON (fail-closed deny matrix)" do
    before { enable_layer3 }

    context "HTML requests" do
      it "DENIES a signed-in user with NO clearance (redirects to the clearance flow)" do
        sign_in user
        get :index
        expect(response).to redirect_to(new_export_control_clearance_path)
      end

      it "DENIES when screening is a HIT" do
        create(:export_control_clearance, :screening_hit, user: user)
        sign_in user
        get :index
        expect(response).to redirect_to(new_export_control_clearance_path)
      end

      it "DENIES when screening is PENDING" do
        create(:export_control_clearance, :screening_pending, user: user)
        sign_in user
        get :index
        expect(response).to redirect_to(new_export_control_clearance_path)
      end

      it "DENIES when the passing clearance is a STALE version" do
        create(:export_control_clearance, :stale_version, user: user)
        sign_in user
        get :index
        expect(response).to redirect_to(new_export_control_clearance_path)
      end

      it "ALLOWS only when the screen is clear for the current version" do
        create(:export_control_clearance, user: user)
        sign_in user
        get :index
        expect(response).to have_http_status(:ok)
      end
    end

    context "non-HTML (JSON) requests are DENIED outright (fail-closed)" do
      it "returns 403 with no clearance" do
        sign_in user
        get :index, format: :json
        expect(response).to have_http_status(:forbidden)
      end
    end

    context "device/location attestation (CZID-286) required" do
      before { enable_device_attestation }

      it "DENIES a cleared user who lacks a current device attestation" do
        create(:export_control_clearance, user: user) # screening clear
        sign_in user
        get :index
        expect(response).to redirect_to(new_device_location_attestation_path)
      end

      it "DENIES when the device attestation FAILED (spoofed)" do
        create(:export_control_clearance, user: user)
        create(:device_location_attestation, :failed, user: user)
        sign_in user
        get :index
        expect(response).to redirect_to(new_device_location_attestation_path)
      end

      it "ALLOWS only when cleared AND device-attested for the current version" do
        create(:export_control_clearance, user: user)
        create(:device_location_attestation, user: user)
        sign_in user
        get :index
        expect(response).to have_http_status(:ok)
      end
    end
  end
end

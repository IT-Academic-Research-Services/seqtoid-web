require 'rails_helper'

# CZID-330 -- branch sweep for the export-control / Terms-of-Use attestation gate. The
# neighbouring layer3 / screening gate specs already prove those hooks; this one isolates
# ExportControlAttestationGate and drives every conditional in require_export_control_attestation
# and its two predicate helpers:
#   - export_control_attestation_enforced?  : flag "1" vs anything else
#   - require_export_control_attestation     : enforced-off return, nil-user return,
#                                              exempt-request return, already-satisfied return,
#                                              and the unsatisfied respond_to matrix
#                                              (declined -> denied path, first-time -> new path,
#                                               non-HTML -> 403 fail-closed)
#   - attestation_exempt_request?            : exempt-controller true, maintenance-true,
#                                              and the neither-true false path
# Spec-only; the gate ships DARK (flag off by default) so the request-driven tests must opt in.
RSpec.describe ExportControlAttestationGate, type: :controller do
  # Anonymous controller inheriting ApplicationController, which already wires
  # before_action :require_export_control_attestation. The other export-control gates stay dark
  # (flags off) so only this hook reacts here.
  controller(ApplicationController) do
    def index
      render plain: "ok"
    end
  end

  before do
    routes.draw { get "anonymous/index" => "anonymous#index" }
  end

  let(:user) { create(:user) }

  def enforce_attestation
    AppConfigHelper.set_app_config(AppConfig::ENABLE_EXPORT_CONTROL_ATTESTATION, "1")
  end

  describe "#export_control_attestation_enforced?" do
    it "is false by default (ships dark)" do
      expect(controller.send(:export_control_attestation_enforced?)).to be(false)
    end

    it "is true only when the flag is exactly '1'" do
      enforce_attestation
      expect(controller.send(:export_control_attestation_enforced?)).to be(true)
    end

    it "is false for a non-'1' flag value" do
      AppConfigHelper.set_app_config(AppConfig::ENABLE_EXPORT_CONTROL_ATTESTATION, "0")
      expect(controller.send(:export_control_attestation_enforced?)).to be(false)
    end
  end

  describe "#require_export_control_attestation (request-driven)" do
    context "when enforcement is OFF (default dark)" do
      it "lets the request through without consulting the attestation model" do
        expect(ExportControlAttestation).not_to receive(:current_attestation_satisfied?)
        sign_in user
        get :index
        expect(response).to have_http_status(:ok)
        expect(response.body).to eq("ok")
      end
    end

    context "when enforcement is ON" do
      before { enforce_attestation }

      it "lets the request through when the attestation is already satisfied" do
        allow(ExportControlAttestation).to receive(:current_attestation_satisfied?).with(user).and_return(true)
        sign_in user
        get :index
        expect(response).to have_http_status(:ok)
        expect(response.body).to eq("ok")
      end

      it "redirects an un-attested user (never declined) to the click-through form" do
        allow(ExportControlAttestation).to receive(:current_attestation_satisfied?).with(user).and_return(false)
        allow(ExportControlAttestation).to receive(:latest_decision_declined?).with(user).and_return(false)
        sign_in user
        get :index
        expect(response).to redirect_to(new_export_control_attestation_path)
      end

      it "redirects a user whose latest decision was a decline to the deny page" do
        allow(ExportControlAttestation).to receive(:current_attestation_satisfied?).with(user).and_return(false)
        allow(ExportControlAttestation).to receive(:latest_decision_declined?).with(user).and_return(true)
        sign_in user
        get :index
        expect(response).to redirect_to(export_control_denied_path)
      end

      it "denies non-HTML (JSON) requests outright while unsatisfied -- fail-closed" do
        allow(ExportControlAttestation).to receive(:current_attestation_satisfied?).with(user).and_return(false)
        sign_in user
        get :index, format: :json
        expect(response).to have_http_status(:forbidden)
        expect(JSON.parse(response.body)["errors"]).to eq(["Export-control attestation required"])
      end
    end
  end

  describe "#require_export_control_attestation (nil-user early return)" do
    it "returns without redirecting when there is no current_user, even if enforced" do
      enforce_attestation
      allow(controller).to receive(:current_user).and_return(nil)
      # nil-user path never reaches the model lookup or a redirect.
      expect(ExportControlAttestation).not_to receive(:current_attestation_satisfied?)
      expect(controller).not_to receive(:redirect_to)
      expect(controller.send(:require_export_control_attestation)).to be_nil
    end
  end

  describe "#require_export_control_attestation (exempt-request early return)" do
    it "returns without consulting the model when the request is exempt, even if enforced" do
      enforce_attestation
      allow(controller).to receive(:current_user).and_return(user)
      allow(controller).to receive(:attestation_exempt_request?).and_return(true)
      expect(ExportControlAttestation).not_to receive(:current_attestation_satisfied?)
      expect(controller.send(:require_export_control_attestation)).to be_nil
    end
  end

  describe "#attestation_exempt_request?" do
    it "is true for a controller on the exempt list (auth0)" do
      allow(controller).to receive(:controller_name).and_return("auth0")
      expect(controller.send(:attestation_exempt_request?)).to be(true)
    end

    it "is true for a non-exempt controller when the site is disabled for maintenance" do
      allow(controller).to receive(:controller_name).and_return("samples")
      allow(controller).to receive(:disabled_for_maintenance?).and_return(true)
      expect(controller.send(:attestation_exempt_request?)).to be(true)
    end

    it "is false for a non-exempt controller when not in maintenance" do
      allow(controller).to receive(:controller_name).and_return("samples")
      allow(controller).to receive(:disabled_for_maintenance?).and_return(false)
      expect(controller.send(:attestation_exempt_request?)).to be(false)
    end
  end
end

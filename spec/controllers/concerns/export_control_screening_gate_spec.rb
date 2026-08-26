require 'rails_helper'

# Composable negated matcher so "no hold AND no screening row" reads as one expectation.
RSpec::Matchers.define_negated_matcher :not_change, :change

# CZID-599 -- the LIVE export-control screening gate, exercised through real before_actions on anonymous
# controllers. The LOAD-BEARING test is the FLAG-OFF PASS-THROUGH: with the master dark flag off, the
# hook must not call ScreeningService, place no hold, and let the request through EXACTLY as today. It
# also proves the per-point toggles, the Descartes-off (nil outcome) pass-through, and that once fully
# enabled the gate is fail-closed (hit/error BLOCK, only a clean screen proceeds).
RSpec.describe ExportControlScreeningGate, type: :controller do
  let(:user) { create(:user) }

  def enable_master
    AppConfigHelper.set_app_config(AppConfig::ENABLE_EXPORT_CONTROL_LAYER3, "1")
  end

  def allowed_outcome
    ExportControl::ScreeningService::Outcome.new(decision: :allowed, screening_result: nil, hold: nil)
  end

  def held_outcome
    ExportControl::ScreeningService::Outcome.new(decision: :held, screening_result: nil, hold: nil)
  end

  def error_outcome
    ExportControl::ScreeningService::Outcome.new(decision: :error, screening_result: nil, hold: nil)
  end

  # ============================================================================================
  # ONBOARDING backstop -- inherited before_action :screen_export_control_onboarding. Isolate it by
  # skipping the OTHER export-control gates so only this hook reacts to the flags.
  # ============================================================================================
  describe "onboarding backstop" do
    controller(ApplicationController) do
      skip_before_action :require_export_control_attestation, raise: false
      skip_before_action :require_export_control_layer3, raise: false

      def index
        render plain: "ok"
      end
    end

    before do
      routes.draw { get "anonymous/index" => "anonymous#index" }
      sign_in user
    end

    def enable_onboarding
      AppConfigHelper.set_app_config(AppConfig::ENABLE_EXPORT_CONTROL_SCREEN_ONBOARDING, "1")
    end

    # ----- THE load-bearing pass-through test -----
    context "master flag OFF (default) -- FULL PASS-THROUGH" do
      it "never touches ScreeningService, places no hold, and lets the request through" do
        expect(ExportControl::ScreeningService).not_to receive(:new)

        expect { get :index }.not_to change(Hold, :count)
        expect(response).to have_http_status(:ok)
        expect(response.body).to eq("ok")
      end
    end

    context "master flag ON but onboarding toggle OFF -- still a pass-through" do
      before { enable_master }

      it "never touches ScreeningService and lets the request through" do
        expect(ExportControl::ScreeningService).not_to receive(:new)
        get :index
        expect(response).to have_http_status(:ok)
      end
    end

    context "master + onboarding ON, but Descartes screening OFF (screen_if_enabled -> nil)" do
      before do
        enable_master
        enable_onboarding
        # ENABLE_DESCARTES_SCREENING stays off -> the real screen_if_enabled returns nil with NO network
        # call and NO rows -> the hook is still a pass-through.
      end

      it "lets the request through (nil outcome == bypass) and writes no rows" do
        expect { get :index }
          .to not_change(Hold, :count).and(not_change(ScreeningResult, :count))
        expect(response).to have_http_status(:ok)
      end
    end

    context "fully enabled + clean screen (:allowed)" do
      before do
        enable_master
        enable_onboarding
        allow_any_instance_of(ExportControl::ScreeningService)
          .to receive(:screen_if_enabled).and_return(allowed_outcome)
      end

      it "proceeds" do
        get :index
        expect(response).to have_http_status(:ok)
      end
    end

    context "fully enabled + screening HOLD (:held) -- fail-closed BLOCK" do
      before do
        enable_master
        enable_onboarding
        allow_any_instance_of(ExportControl::ScreeningService)
          .to receive(:screen_if_enabled).and_return(held_outcome)
      end

      it "blocks and redirects to the access-under-review page" do
        get :index
        expect(response).to redirect_to(export_control_clearance_denied_path)
      end
    end

    context "fully enabled + screening ERROR (:error) -- fail-closed BLOCK" do
      before do
        enable_master
        enable_onboarding
        allow_any_instance_of(ExportControl::ScreeningService)
          .to receive(:screen_if_enabled).and_return(error_outcome)
      end

      it "blocks and redirects to the access-under-review page (never allow-on-uncertainty)" do
        get :index
        expect(response).to redirect_to(export_control_clearance_denied_path)
      end
    end
  end

  # ============================================================================================
  # RESULT-RELEASE backstop -- wire :screen_export_control_release explicitly; skip onboarding so only
  # the release hook is under test.
  # ============================================================================================
  describe "result-release backstop" do
    controller(ApplicationController) do
      skip_before_action :require_export_control_attestation, raise: false
      skip_before_action :require_export_control_layer3, raise: false
      skip_before_action :screen_export_control_onboarding, raise: false
      before_action :screen_export_control_release

      def index
        render plain: "ok"
      end
    end

    before do
      routes.draw { get "anonymous/index" => "anonymous#index" }
      sign_in user
    end

    def enable_release
      AppConfigHelper.set_app_config(AppConfig::ENABLE_EXPORT_CONTROL_SCREEN_RELEASE, "1")
    end

    it "master OFF -- pass-through, ScreeningService untouched" do
      expect(ExportControl::ScreeningService).not_to receive(:new)
      get :index
      expect(response).to have_http_status(:ok)
    end

    it "release toggle stays independent of onboarding (master + release ON, hit -> BLOCK)" do
      enable_master
      enable_release
      allow_any_instance_of(ExportControl::ScreeningService)
        .to receive(:screen_if_enabled).and_return(held_outcome)

      get :index
      expect(response).to redirect_to(export_control_clearance_denied_path)
    end

    it "master ON but release toggle OFF -- pass-through even if onboarding were on" do
      enable_master
      AppConfigHelper.set_app_config(AppConfig::ENABLE_EXPORT_CONTROL_SCREEN_ONBOARDING, "1")
      expect(ExportControl::ScreeningService).not_to receive(:new)
      get :index
      expect(response).to have_http_status(:ok)
    end
  end
end

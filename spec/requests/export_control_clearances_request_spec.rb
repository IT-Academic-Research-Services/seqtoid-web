require 'rails_helper'

# CZID-285 -- request specs for the Layer 3 export-screening clearance flow.
#
# Approval is attestation + denied-party screening, with NO document-IDV step. This spec drives the
# clearance controller's screening half.
#
# FAIL-CLOSED / deny-by-default security surface. The ONLY way `create` routes a user onward to the app is
# a clearance row whose screen is CLEAR. EVERY other provider outcome (pending, hit, provider raise)
# records a NON-passed row and routes to the non-bypassable deny page.
#
# See app/controllers/export_control_clearances_controller.rb, app/models/export_control_clearance.rb,
# and app/services/export_control/denied_party_screening_provider.rb.
#
# NOTE ON THE COMMITTED STUB: the reference screening provider returns PENDING (never a synthetic "clear"),
# so with the real committed code the ALLOW branch of `create` is UNREACHABLE -- the gate stays closed
# until a DPA-backed vendor is wired. To exercise the allow branch at all we must explicitly stub the
# provider to return a clear screen; the deny specs run against the REAL committed provider.
RSpec.describe "ExportControlClearances", type: :request do
  create_users

  def screen_result(result)
    ExportControl::DeniedPartyScreeningProvider::Result.new(
      result: result, provider: "reference_stub", evidence_ref: "screen-ref"
    )
  end

  def stub_screen(result)
    allow(ExportControl::DeniedPartyScreeningProvider).to receive(:screen).and_return(screen_result(result))
  end

  describe "GET /export_control_clearance (new -- the hand-off)" do
    context "unauthenticated (deny-by-default)" do
      it "does not render the clearance start page to an anonymous user" do
        get new_export_control_clearance_path
        expect(response).not_to have_http_status(:ok)
        expect(response).to have_http_status(:redirect).or have_http_status(:unauthorized)
      end
    end

    context "authenticated, NOT yet cleared" do
      before { sign_in @joe }

      it "renders the clearance hand-off page" do
        get new_export_control_clearance_path
        expect(response).to have_http_status(:ok)
      end
    end

    context "authenticated AND already holds a passed current clearance" do
      before do
        sign_in @joe
        create(:export_control_clearance, user: @joe) # default factory == clear + current
      end

      it "redirects a satisfied user home" do
        get new_export_control_clearance_path
        expect(response).to redirect_to(root_path)
      end
    end

    # Each of these is a clearance row that must NOT satisfy the gate -> user is NOT sent home.
    {
      "screening hit"               => :screening_hit,
      "screening pending"           => :screening_pending,
      "a stale clearance version"   => :stale_version,
    }.each do |label, trait|
      context "authenticated but only #{label} (deny-by-default)" do
        before do
          sign_in @joe
          create(:export_control_clearance, trait, user: @joe)
        end

        it "does NOT treat #{label} as cleared -- shows the hand-off, not root" do
          get new_export_control_clearance_path
          expect(response).to have_http_status(:ok)
          expect(response).not_to redirect_to(root_path)
        end
      end
    end
  end

  describe "POST /export_control_clearance (create -- run screening, record, route)" do
    context "unauthenticated (deny-by-default)" do
      it "does not create a clearance and does not route to root" do
        expect { post export_control_clearances_path }.not_to change(ExportControlClearance, :count)
        expect(response).not_to redirect_to(root_path)
      end
    end

    context "authenticated" do
      before { sign_in @joe }

      # ---- The single ALLOW branch: a CLEAR screen (requires stubbing the provider) ----
      context "screening CLEAR (the ONLY allow path)" do
        before { stub_screen(ExportControlClearance::SCREENING_CLEAR) }

        it "records a PASSED row and routes the user onward to the app" do
          expect do
            post export_control_clearances_path
          end.to change(ExportControlClearance, :count).by(1)
          rec = ExportControlClearance.last
          expect(rec).to be_passed
          expect(rec.user_id).to eq(@joe.id)
          expect(rec.clearance_version).to eq(ExportControlClearance::CURRENT_VERSION)
          # The IDV lane is gone: nothing writes a verification_status any more.
          expect(rec.verification_status).to be_nil
          expect(response).to redirect_to(root_path)
        end
      end

      # ---- DENY branches: any non-clear screen records a row and denies ----
      # NOTE: the table uses the literal DB string values (not the model constants) so it can be built at
      # file-load time without triggering Rails autoloading of the model class before the suite boots.
      {
        "screening HIT"     => "hit",
        "screening PENDING" => "pending",
      }.each do |label, screen|
        context "#{label} (deny)" do
          before { stub_screen(screen) }

          it "records a NON-passed row and routes to the deny page" do
            expect { post export_control_clearances_path }.to change(ExportControlClearance, :count).by(1)
            expect(ExportControlClearance.last).not_to be_passed
            expect(response).to redirect_to(export_control_clearance_denied_path)
          end
        end
      end

      context "against the REAL committed reference stub (no stubbing)" do
        it "denies -- the committed provider returns PENDING, so no user is ever let through without a clear screen" do
          expect { post export_control_clearances_path }.to change(ExportControlClearance, :count).by(1)
          rec = ExportControlClearance.last
          expect(rec).not_to be_passed
          expect(rec.screening_result).to eq(ExportControlClearance::SCREENING_PENDING)
          expect(response).to redirect_to(export_control_clearance_denied_path)
        end
      end

      context "the screening provider RAISES (fail-closed on error/timeout)" do
        before do
          allow(ExportControl::DeniedPartyScreeningProvider).to receive(:screen).and_raise(StandardError, "vendor timeout")
        end

        it "records a best-effort non-passed row and DENIES (never falls through to allow)" do
          expect { post export_control_clearances_path }.to change(ExportControlClearance, :count).by(1)
          rec = ExportControlClearance.last
          expect(rec.screening_result).to eq(ExportControlClearance::SCREENING_PENDING)
          expect(rec).not_to be_passed
          expect(response).to redirect_to(export_control_clearance_denied_path)
        end

        it "still DENIES even if the best-effort evidence write ALSO fails" do
          allow(ExportControlClearance).to receive(:create!).and_raise(StandardError, "db down")
          post export_control_clearances_path
          expect(response).to redirect_to(export_control_clearance_denied_path)
          expect(response).not_to redirect_to(root_path)
        end
      end
    end
  end

  describe "GET /export_control_clearance_denied (the deny UX)" do
    before { sign_in @joe }

    it "renders with a 403 Forbidden status" do
      get export_control_clearance_denied_path
      expect(response).to have_http_status(:forbidden)
    end
  end
end

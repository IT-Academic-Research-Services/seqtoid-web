require 'rails_helper'

# CZID-285 — request specs for the Layer 3 identity-verification + export-screening clearance flow.
#
# ⚠️ FAIL-CLOSED / deny-by-default security surface. The ONLY way `create` routes a user onward to the
# app is a clearance row that is BOTH verified AND clear. EVERY other provider outcome (pending, failed,
# screening hit, provider raise) records a NON-passed row and routes to the non-bypassable deny page.
# The webhook `callback` must reject any request whose signature does not verify (fail-closed) — and
# with NO signing secret wired (the committed default) EVERY callback is rejected 403.
#
# See app/controllers/export_control_clearances_controller.rb, app/models/export_control_clearance.rb,
# and app/services/export_control/{identity_verification,denied_party_screening}_provider.rb.
#
# NOTE ON THE COMMITTED STUBS: the reference providers return PENDING (never a synthetic "verified"), so
# with the real committed code the ALLOW branch of `create` is UNREACHABLE — the gate stays closed until a
# DPA-backed vendor is wired. To exercise the allow branch at all we must explicitly stub the providers to
# return affirmative results; the deny specs run against the REAL committed providers.
RSpec.describe "ExportControlClearances", type: :request do
  create_users

  # Struct doubles matching the provider Result contracts.
  def idv_result(status)
    ExportControl::IdentityVerificationProvider::Result.new(
      status: status, provider: "reference_stub", evidence_ref: "idv-ref"
    )
  end

  def screen_result(result)
    ExportControl::DeniedPartyScreeningProvider::Result.new(
      result: result, provider: "reference_stub", evidence_ref: "screen-ref"
    )
  end

  def stub_providers(idv:, screen:)
    allow(ExportControl::IdentityVerificationProvider).to receive(:verify).and_return(idv_result(idv))
    allow(ExportControl::DeniedPartyScreeningProvider).to receive(:screen).and_return(screen_result(screen))
  end

  describe "GET /export_control_clearance (new — the hand-off)" do
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
        create(:export_control_clearance, user: @joe) # default factory == verified + clear + current
      end

      it "redirects a satisfied user home" do
        get new_export_control_clearance_path
        expect(response).to redirect_to(root_path)
      end
    end

    # Each of these is a clearance row that must NOT satisfy the gate → user is NOT sent home.
    {
      "verification pending"        => :verification_pending,
      "verification failed"         => :verification_failed,
      "screening hit"               => :screening_hit,
      "screening pending"           => :screening_pending,
      "a stale clearance version"   => :stale_version,
    }.each do |label, trait|
      context "authenticated but only #{label} (deny-by-default)" do
        before do
          sign_in @joe
          create(:export_control_clearance, trait, user: @joe)
        end

        it "does NOT treat #{label} as cleared — shows the hand-off, not root" do
          get new_export_control_clearance_path
          expect(response).to have_http_status(:ok)
          expect(response).not_to redirect_to(root_path)
        end
      end
    end
  end

  describe "POST /export_control_clearance (create — run IDV + screening, record, route)" do
    context "unauthenticated (deny-by-default)" do
      it "does not create a clearance and does not route to root" do
        expect { post export_control_clearances_path }.not_to change(ExportControlClearance, :count)
        expect(response).not_to redirect_to(root_path)
      end
    end

    context "authenticated" do
      before { sign_in @joe }

      # ---- The single ALLOW branch: verified AND clear (requires stubbing the providers) ----
      context "IDV verified AND screening clear (the ONLY allow path)" do
        before { stub_providers(idv: ExportControlClearance::VERIFICATION_VERIFIED, screen: ExportControlClearance::SCREENING_CLEAR) }

        it "records a PASSED row and routes the user onward to the app" do
          expect do
            post export_control_clearances_path
          end.to change(ExportControlClearance, :count).by(1)
          rec = ExportControlClearance.last
          expect(rec).to be_passed
          expect(rec.user_id).to eq(@joe.id)
          expect(rec.clearance_version).to eq(ExportControlClearance::CURRENT_VERSION)
          expect(response).to redirect_to(root_path)
        end
      end

      # ---- DENY branches: any non-(verified AND clear) combination records a row and denies ----
      # NOTE: the table uses the literal DB string values (not the model constants) so it can be built at
      # file-load time without triggering Rails autoloading of the model class before the suite boots.
      {
        "verified but screening HIT"            => %w[verified hit],
        "verified but screening PENDING"        => %w[verified pending],
        "IDV PENDING even if screening clear"   => %w[pending clear],
        "IDV FAILED even if screening clear"    => %w[failed clear],
        "both pending"                          => %w[pending pending],
      }.each do |label, (idv, screen)|
        context "#{label} (deny)" do
          before { stub_providers(idv: idv, screen: screen) }

          it "records a NON-passed row and routes to the deny page" do
            expect { post export_control_clearances_path }.to change(ExportControlClearance, :count).by(1)
            expect(ExportControlClearance.last).not_to be_passed
            expect(response).to redirect_to(export_control_clearance_denied_path)
          end
        end
      end

      context "against the REAL committed reference stubs (no stubbing)" do
        it "denies — the committed providers return PENDING, so no user is ever let through" do
          expect { post export_control_clearances_path }.to change(ExportControlClearance, :count).by(1)
          rec = ExportControlClearance.last
          expect(rec).not_to be_passed
          expect(rec.verification_status).to eq(ExportControlClearance::VERIFICATION_PENDING)
          expect(response).to redirect_to(export_control_clearance_denied_path)
        end
      end

      context "a provider RAISES (fail-closed on error/timeout)" do
        before do
          allow(ExportControl::IdentityVerificationProvider).to receive(:verify).and_raise(StandardError, "vendor timeout")
        end

        it "records a best-effort failed row and DENIES (never falls through to allow)" do
          expect { post export_control_clearances_path }.to change(ExportControlClearance, :count).by(1)
          rec = ExportControlClearance.last
          expect(rec.verification_status).to eq(ExportControlClearance::VERIFICATION_FAILED)
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

  describe "POST /export_control_clearance/callback (IDV vendor webhook — signature-verified)" do
    # The callback skips CSRF and is server-to-server; it authenticates ONLY via the provider signature.
    context "with NO signing secret configured (the committed default — fail-closed)" do
      before { sign_in @joe }

      it "rejects a callback that carries no signature header with 403 and records nothing" do
        expect do
          post export_control_clearance_callback_path, params: { any: "payload" }
        end.not_to change(ExportControlClearance, :count)
        expect(response).to have_http_status(:forbidden)
      end

      it "rejects a callback even WITH a signature header (no secret ⇒ cannot verify ⇒ deny)" do
        expect do
          post export_control_clearance_callback_path,
               params: { any: "payload" },
               headers: { "X-Export-Control-Signature" => "deadbeef" }
        end.not_to change(ExportControlClearance, :count)
        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when a signing secret IS wired (verify the HMAC path)" do
      before do
        sign_in @joe
        # Simulate a configured secret so we can exercise the signature comparison branch.
        allow_any_instance_of(ExportControlClearancesController)
          .to receive(:idv_callback_secret).and_return("shhh-secret")
        # Keep the committed provider behaviour (PENDING) so even a valid signature does NOT create a pass.
      end

      it "still rejects a WRONG signature with 403 (deny-by-default)" do
        expect do
          post export_control_clearance_callback_path,
               params: "raw-body",
               headers: { "X-Export-Control-Signature" => "not-the-right-hmac", "CONTENT_TYPE" => "text/plain" }
        end.not_to change(ExportControlClearance, :count)
        expect(response).to have_http_status(:forbidden)
      end

      it "accepts a CORRECT signature, records the (PENDING) outcome, and does not synthesize a pass" do
        raw = "raw-body"
        sig = OpenSSL::HMAC.hexdigest("SHA256", "shhh-secret", raw)
        expect do
          post export_control_clearance_callback_path,
               params: raw,
               headers: { "X-Export-Control-Signature" => sig, "CONTENT_TYPE" => "text/plain" }
        end.to change(ExportControlClearance, :count).by(1)
        expect(response).to have_http_status(:ok)
        # A verified-signature callback is authenticated, but the committed provider yields PENDING → NOT passed.
        expect(ExportControlClearance.last).not_to be_passed
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

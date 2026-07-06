require 'rails_helper'

# CZID-330 — request specs for the export-control / Terms-of-Use attestation click-through.
#
# ⚠️ FAIL-CLOSED / deny-by-default security surface. The point of these specs is NOT the happy path;
# it is to pin, exhaustively, that the ONLY way a user is routed onward to the app is an explicit
# `decision == "accepted"`, and that EVERY other input (declined, missing param, junk param, a failed
# record write, an unauthenticated request) DENIES — i.e. sends the user to a deny/attest screen and
# NEVER to root_path as an "attested" user.
#
# See app/controllers/export_control_attestations_controller.rb and
# app/models/export_control_attestation.rb (current_attestation_satisfied? — the fail-closed predicate).
RSpec.describe "ExportControlAttestations", type: :request do
  create_users

  # The controller is EXEMPT from the attestation gate, and enforcement is OFF by default, so these
  # actions are reachable for any authenticated user regardless of gate state. Auth is still required.

  describe "GET /export_control_attestation (new — the click-through)" do
    context "unauthenticated (deny-by-default: no session)" do
      it "does NOT render the attestation form to an anonymous user" do
        get new_export_control_attestation_path
        # Warden failure_app / authenticate_user! intercepts before the action runs.
        expect(response).not_to have_http_status(:ok)
        expect(response).to have_http_status(:redirect).or have_http_status(:unauthorized)
      end
    end

    context "authenticated, NOT yet attested" do
      before { sign_in @joe }

      it "renders the click-through form (does not skip the gate)" do
        get new_export_control_attestation_path
        expect(response).to have_http_status(:ok)
      end
    end

    context "authenticated AND already accepted the current version" do
      before do
        sign_in @joe
        create(:export_control_attestation, user: @joe,
                                            decision: ExportControlAttestation::DECISION_ACCEPTED,
                                            attestation_version: ExportControlAttestation::CURRENT_VERSION)
      end

      it "redirects a satisfied user home instead of nagging" do
        get new_export_control_attestation_path
        expect(response).to redirect_to(root_path)
      end
    end

    context "authenticated but only a STALE-version acceptance exists (deny-by-default)" do
      before do
        sign_in @joe
        create(:export_control_attestation, user: @joe,
                                            decision: ExportControlAttestation::DECISION_ACCEPTED,
                                            attestation_version: "v0-old")
      end

      it "does NOT treat a stale acceptance as satisfying — shows the form again" do
        get new_export_control_attestation_path
        expect(response).to have_http_status(:ok)
        expect(response).not_to redirect_to(root_path)
      end
    end

    context "authenticated but latest decision is DECLINED (deny-by-default)" do
      before do
        sign_in @joe
        create(:export_control_attestation, user: @joe,
                                            decision: ExportControlAttestation::DECISION_DECLINED,
                                            attestation_version: ExportControlAttestation::CURRENT_VERSION)
      end

      it "does NOT redirect a declined user home (they are not satisfied)" do
        get new_export_control_attestation_path
        expect(response).to have_http_status(:ok)
        expect(response).not_to redirect_to(root_path)
      end
    end
  end

  describe "POST /export_control_attestation (create — record the decision)" do
    context "unauthenticated (deny-by-default)" do
      it "does not record an attestation and does not route to root" do
        expect do
          post export_control_attestations_path, params: { decision: ExportControlAttestation::DECISION_ACCEPTED }
        end.not_to change(ExportControlAttestation, :count)
        expect(response).not_to redirect_to(root_path)
      end
    end

    context "authenticated" do
      before { sign_in @joe }

      # ---- The single ALLOW branch: an explicit "accepted" ----
      context "decision == accepted (the ONLY allow path)" do
        it "records an accepted row and routes the user onward to the app" do
          expect do
            post export_control_attestations_path, params: { decision: ExportControlAttestation::DECISION_ACCEPTED }
          end.to change(ExportControlAttestation, :count).by(1)

          rec = ExportControlAttestation.last
          expect(rec.user_id).to eq(@joe.id)
          expect(rec.decision).to eq(ExportControlAttestation::DECISION_ACCEPTED)
          expect(rec.attestation_version).to eq(ExportControlAttestation::CURRENT_VERSION)
          expect(response).to redirect_to(root_path)
        end

        it "captures compliance evidence (version, IP, user agent) on the record" do
          post export_control_attestations_path,
               params: { decision: ExportControlAttestation::DECISION_ACCEPTED },
               headers: { "HTTP_USER_AGENT" => "SpecAgent/1.0" }
          rec = ExportControlAttestation.last
          expect(rec.attestation_version).to eq(ExportControlAttestation::CURRENT_VERSION)
          expect(rec.ip_address).to be_present
          expect(rec.user_agent).to include("SpecAgent")
        end
      end

      # ---- DENY branches: every non-"accepted" input records a DECLINE and routes to the deny page ----
      context "decision == declined (deny)" do
        it "records a DECLINED row and routes to the non-bypassable deny page" do
          expect do
            post export_control_attestations_path, params: { decision: ExportControlAttestation::DECISION_DECLINED }
          end.to change(ExportControlAttestation, :count).by(1)
          expect(ExportControlAttestation.last.decision).to eq(ExportControlAttestation::DECISION_DECLINED)
          expect(response).to redirect_to(export_control_denied_path)
        end
      end

      context "decision param MISSING (deny-by-default — the critical fail-closed default)" do
        it "treats a missing decision as DECLINED and denies (never accepted)" do
          post export_control_attestations_path, params: {}
          rec = ExportControlAttestation.last
          expect(rec.decision).to eq(ExportControlAttestation::DECISION_DECLINED)
          expect(rec.decision).not_to eq(ExportControlAttestation::DECISION_ACCEPTED)
          expect(response).to redirect_to(export_control_denied_path)
        end
      end

      context "decision param is JUNK / unexpected value (deny-by-default)" do
        it "treats an unrecognized decision as DECLINED and denies" do
          post export_control_attestations_path, params: { decision: "yes-please-let-me-in" }
          expect(ExportControlAttestation.last.decision).to eq(ExportControlAttestation::DECISION_DECLINED)
          expect(response).to redirect_to(export_control_denied_path)
        end

        it "does not accept a case-variant of 'accepted' (exact match only)" do
          post export_control_attestations_path, params: { decision: "Accepted" }
          expect(ExportControlAttestation.last.decision).to eq(ExportControlAttestation::DECISION_DECLINED)
          expect(response).to redirect_to(export_control_denied_path)
        end

        it "does not accept a truthy-looking non-string (deny)" do
          post export_control_attestations_path, params: { decision: "1" }
          expect(ExportControlAttestation.last.decision).to eq(ExportControlAttestation::DECISION_DECLINED)
          expect(response).to redirect_to(export_control_denied_path)
        end
      end

      context "the evidence write FAILS (fail-closed on persistence error)" do
        before do
          allow(ExportControlAttestation).to receive(:create!)
            .and_raise(ActiveRecord::RecordInvalid.new(ExportControlAttestation.new))
        end

        it "does NOT let the user through — re-prompts to attest, never routes to root" do
          post export_control_attestations_path, params: { decision: ExportControlAttestation::DECISION_ACCEPTED }
          expect(response).to redirect_to(new_export_control_attestation_path)
          expect(response).not_to redirect_to(root_path)
        end
      end
    end
  end

  describe "GET /export_control_denied (the deny UX)" do
    before { sign_in @joe }

    it "renders with a 403 Forbidden status (not a soft 200)" do
      get export_control_denied_path
      expect(response).to have_http_status(:forbidden)
    end
  end
end

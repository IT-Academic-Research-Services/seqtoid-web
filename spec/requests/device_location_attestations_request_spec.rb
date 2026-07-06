require 'rails_helper'

# CZID-286 — request specs for the Layer 3 device / location attestation (server-side token verify).
#
# ⚠️ FAIL-CLOSED / deny-by-default security surface. The server VERIFIES a signed attestation token via
# the provider-agnostic DeviceLocationProvider. The ONLY way `create` routes onward is a status ==
# "verified" result. A nil/blank/malformed/expired/spoofed token, a bad signature, or a provider raise
# all record a NON-verified row and route to the non-bypassable deny page.
#
# See app/controllers/device_location_attestations_controller.rb, app/models/device_location_attestation.rb,
# and app/services/export_control/{device_location_provider,providers/device_reference_stub}.rb.
#
# NOTE ON THE COMMITTED STUB: DeviceReferenceStub NEVER returns "verified" (no signing key wired → every
# token fails closed). So with the real committed code the ALLOW branch is UNREACHABLE; to exercise it we
# explicitly stub the provider. The deny specs run against the REAL committed verifier.
RSpec.describe "DeviceLocationAttestations", type: :request do
  create_users

  def verify_result(status:, failure_reason: nil, asserted_country: "US")
    ExportControl::DeviceLocationProvider::Result.new(
      status: status, failure_reason: failure_reason, provider: "reference_stub",
      attestation_ref: "dev-ref", asserted_country: asserted_country
    )
  end

  describe "GET /device_location_attestation (new — the step-up page)" do
    context "unauthenticated (deny-by-default)" do
      it "does not render the step-up page to an anonymous user" do
        get new_device_location_attestation_path
        expect(response).not_to have_http_status(:ok)
        expect(response).to have_http_status(:redirect).or have_http_status(:unauthorized)
      end
    end

    context "authenticated, NOT yet attested" do
      before { sign_in @joe }

      it "renders the step-up page" do
        get new_device_location_attestation_path
        expect(response).to have_http_status(:ok)
      end
    end

    context "authenticated AND already holds a verified current attestation" do
      before do
        sign_in @joe
        create(:device_location_attestation, user: @joe) # default == verified + current
      end

      it "redirects a satisfied user home" do
        get new_device_location_attestation_path
        expect(response).to redirect_to(root_path)
      end
    end

    {
      "a pending attestation"          => :pending,
      "a failed attestation"           => :failed,
      "a stale-version attestation"    => :stale_version,
    }.each do |label, trait|
      context "authenticated but only #{label} (deny-by-default)" do
        before do
          sign_in @joe
          create(:device_location_attestation, trait, user: @joe)
        end

        it "does NOT treat #{label} as satisfying — shows the step-up, not root" do
          get new_device_location_attestation_path
          expect(response).to have_http_status(:ok)
          expect(response).not_to redirect_to(root_path)
        end
      end
    end
  end

  describe "POST /device_location_attestation (create — verify token, record, route)" do
    context "unauthenticated (deny-by-default)" do
      it "does not record and does not route to root" do
        expect do
          post device_location_attestations_path, params: { attestation_token: "tok" }
        end.not_to change(DeviceLocationAttestation, :count)
        expect(response).not_to redirect_to(root_path)
      end
    end

    context "authenticated" do
      before { sign_in @joe }

      context "token verifies (the ONLY allow path — requires stubbing the provider)" do
        before do
          allow(ExportControl::DeviceLocationProvider).to receive(:verify_token)
            .and_return(verify_result(status: DeviceLocationAttestation::STATUS_VERIFIED))
        end

        it "records a VERIFIED row and routes the user onward to the app" do
          expect do
            post device_location_attestations_path, params: { attestation_token: "good-token" }
          end.to change(DeviceLocationAttestation, :count).by(1)
          rec = DeviceLocationAttestation.last
          expect(rec.attestation_status).to eq(DeviceLocationAttestation::STATUS_VERIFIED)
          expect(rec.user_id).to eq(@joe.id)
          expect(response).to redirect_to(root_path)
        end
      end

      # DENY branches driven through the provider result.
      # NOTE: literal DB string values (not model constants) so the table builds at file-load time without
      # triggering Rails autoloading of the model class before the suite boots.
      {
        "provider returns FAILED (bad signature)" => %w[failed invalid_signature],
        "provider returns FAILED (spoofed)"       => %w[failed spoofed],
        "provider returns FAILED (expired)"       => %w[failed expired],
        "provider returns PENDING"                => ["pending", nil],
      }.each do |label, (status, reason)|
        context "#{label} (deny)" do
          before do
            allow(ExportControl::DeviceLocationProvider).to receive(:verify_token)
              .and_return(verify_result(status: status, failure_reason: reason))
          end

          it "records a NON-verified row and routes to the deny page" do
            expect do
              post device_location_attestations_path, params: { attestation_token: "tok" }
            end.to change(DeviceLocationAttestation, :count).by(1)
            expect(DeviceLocationAttestation.last.attestation_status).not_to eq(DeviceLocationAttestation::STATUS_VERIFIED)
            expect(response).to redirect_to(device_location_attestation_denied_path)
          end
        end
      end

      context "against the REAL committed reference verifier (no stubbing)" do
        it "denies a well-formed-looking token — the stub never returns verified" do
          expect do
            post device_location_attestations_path, params: { attestation_token: "looks-legit" }
          end.to change(DeviceLocationAttestation, :count).by(1)
          rec = DeviceLocationAttestation.last
          expect(rec.attestation_status).to eq(DeviceLocationAttestation::STATUS_FAILED)
          expect(rec.failure_reason).to eq(DeviceLocationAttestation::FAILURE_INVALID_SIGNATURE)
          expect(response).to redirect_to(device_location_attestation_denied_path)
        end

        it "denies a MISSING token (malformed) and records a failed row" do
          expect do
            post device_location_attestations_path, params: {}
          end.to change(DeviceLocationAttestation, :count).by(1)
          rec = DeviceLocationAttestation.last
          expect(rec.attestation_status).to eq(DeviceLocationAttestation::STATUS_FAILED)
          expect(rec.failure_reason).to eq(DeviceLocationAttestation::FAILURE_MALFORMED)
          expect(response).to redirect_to(device_location_attestation_denied_path)
        end

        it "denies a BLANK token (malformed)" do
          post device_location_attestations_path, params: { attestation_token: "   " }
          expect(DeviceLocationAttestation.last.failure_reason).to eq(DeviceLocationAttestation::FAILURE_MALFORMED)
          expect(response).to redirect_to(device_location_attestation_denied_path)
        end
      end

      context "the verifier RAISES (fail-closed on provider error)" do
        before do
          allow(ExportControl::DeviceLocationProvider).to receive(:verify_token).and_raise(StandardError, "verifier down")
        end

        it "records a best-effort failed row and DENIES (never falls through to allow)" do
          expect do
            post device_location_attestations_path, params: { attestation_token: "tok" }
          end.to change(DeviceLocationAttestation, :count).by(1)
          rec = DeviceLocationAttestation.last
          expect(rec.attestation_status).to eq(DeviceLocationAttestation::STATUS_FAILED)
          expect(rec.failure_reason).to eq(DeviceLocationAttestation::FAILURE_PROVIDER_ERROR)
          expect(response).to redirect_to(device_location_attestation_denied_path)
        end

        it "still DENIES even if the best-effort evidence write ALSO fails" do
          allow(DeviceLocationAttestation).to receive(:create!).and_raise(StandardError, "db down")
          post device_location_attestations_path, params: { attestation_token: "tok" }
          expect(response).to redirect_to(device_location_attestation_denied_path)
          expect(response).not_to redirect_to(root_path)
        end
      end
    end
  end

  describe "GET /device_location_attestation_denied (the deny UX)" do
    before { sign_in @joe }

    it "renders with a 403 Forbidden status" do
      get device_location_attestation_denied_path
      expect(response).to have_http_status(:forbidden)
    end
  end
end

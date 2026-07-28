require 'rails_helper'

# CZID-285 branch sweep for ExportControlClearancesController, companion to
# export_control_clearances_request_spec.rb. That spec drives the allow/deny
# routing; the arms left untaken here are the ones that need request metadata or
# a wired signing secret:
#
#   * record_clearance / record_provider_error / request_evidence_ctx all read
#     `request.user_agent&.slice(0, 1024)`. The main spec never sends a
#     User-Agent, so only the nil arm of the safe-navigation is taken.
#   * verify_idv_callback_signature!'s `return false if provided.blank?` -- only
#     reachable once a secret IS configured AND no signature header is sent
#     (with the committed nil secret the method short-circuits one line earlier).
#
# FAIL-CLOSED surface: every example below still asserts the deny outcome.
RSpec.describe "ExportControlClearances branches", type: :request do
  create_users

  # A user agent longer than the 1024-char slice, so the slice is observable.
  let(:long_user_agent) { "Mozilla/5.0 (#{'x' * 1200})" }

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

  describe "POST create records the request User-Agent on the evidence row" do
    before { sign_in @joe }

    it "truncates a long User-Agent to 1024 characters on a PASSED row" do
      allow(ExportControl::IdentityVerificationProvider).to receive(:verify)
        .and_return(idv_result(ExportControlClearance::VERIFICATION_VERIFIED))
      allow(ExportControl::DeniedPartyScreeningProvider).to receive(:screen)
        .and_return(screen_result(ExportControlClearance::SCREENING_CLEAR))

      expect do
        post export_control_clearances_path, headers: { "HTTP_USER_AGENT" => long_user_agent }
      end.to change(ExportControlClearance, :count).by(1)

      rec = ExportControlClearance.last
      expect(rec.user_agent).to eq(long_user_agent.slice(0, 1024))
      expect(rec.user_agent.length).to eq(1024)
      expect(response).to redirect_to(root_path)
    end

    it "records a short User-Agent verbatim on a DENIED row (real committed stubs)" do
      ua = "SeqtoidTest/1.0"

      expect do
        post export_control_clearances_path, headers: { "HTTP_USER_AGENT" => ua }
      end.to change(ExportControlClearance, :count).by(1)

      rec = ExportControlClearance.last
      expect(rec.user_agent).to eq(ua)
      expect(rec).not_to be_passed
      expect(response).to redirect_to(export_control_clearance_denied_path)
    end

    it "passes the User-Agent through to the providers' evidence context" do
      ua = "SeqtoidTest/2.0"
      captured = nil
      allow(ExportControl::IdentityVerificationProvider).to receive(:verify) do |_user, ctx|
        captured = ctx
        idv_result(ExportControlClearance::VERIFICATION_PENDING)
      end

      post export_control_clearances_path, headers: { "HTTP_USER_AGENT" => ua }

      expect(captured[:user_agent]).to eq(ua)
      expect(response).to redirect_to(export_control_clearance_denied_path)
    end

    it "records the truncated User-Agent on the failed row when a provider RAISES" do
      allow(ExportControl::IdentityVerificationProvider).to receive(:verify)
        .and_raise(StandardError, "vendor timeout")

      expect do
        post export_control_clearances_path, headers: { "HTTP_USER_AGENT" => long_user_agent }
      end.to change(ExportControlClearance, :count).by(1)

      rec = ExportControlClearance.last
      expect(rec.verification_status).to eq(ExportControlClearance::VERIFICATION_FAILED)
      expect(rec.user_agent.length).to eq(1024)
      expect(response).to redirect_to(export_control_clearance_denied_path)
    end
  end

  describe "POST callback with a secret wired but NO signature header" do
    before do
      sign_in @joe
      allow_any_instance_of(ExportControlClearancesController)
        .to receive(:idv_callback_secret).and_return("shhh-secret")
    end

    it "rejects with 403 and records nothing (the blank-signature guard)" do
      expect do
        post export_control_clearance_callback_path,
             params: "raw-body",
             headers: { "CONTENT_TYPE" => "text/plain" }
      end.not_to change(ExportControlClearance, :count)

      expect(response).to have_http_status(:forbidden)
    end

    it "rejects an empty-string signature header just as it rejects a missing one" do
      expect do
        post export_control_clearance_callback_path,
             params: "raw-body",
             headers: { "X-Export-Control-Signature" => "", "CONTENT_TYPE" => "text/plain" }
      end.not_to change(ExportControlClearance, :count)

      expect(response).to have_http_status(:forbidden)
    end
  end
end

require 'rails_helper'

# CZID-285 branch sweep for ExportControlClearancesController, companion to
# export_control_clearances_request_spec.rb. That spec drives the allow/deny
# routing; the arms left untaken here are the ones that need request metadata:
#
#   * record_clearance / record_provider_error / request_evidence_ctx all read
#     `request.user_agent&.slice(0, 1024)`. The main spec never sends a
#     User-Agent, so only the nil arm of the safe-navigation is taken.
#
# FAIL-CLOSED surface: every example below still asserts the deny outcome (or the single stubbed-clear
# allow path). Approval is attestation + denied-party screening, with NO document-IDV step.
RSpec.describe "ExportControlClearances branches", type: :request do
  create_users

  # A user agent longer than the 1024-char slice, so the slice is observable.
  let(:long_user_agent) { "Mozilla/5.0 (#{'x' * 1200})" }

  def screen_result(result)
    ExportControl::DeniedPartyScreeningProvider::Result.new(
      result: result, provider: "reference_stub", evidence_ref: "screen-ref"
    )
  end

  describe "POST create records the request User-Agent on the evidence row" do
    before { sign_in @joe }

    it "truncates a long User-Agent to 1024 characters on a PASSED row" do
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

    it "records a short User-Agent verbatim on a DENIED row (real committed stub)" do
      ua = "SeqtoidTest/1.0"

      expect do
        post export_control_clearances_path, headers: { "HTTP_USER_AGENT" => ua }
      end.to change(ExportControlClearance, :count).by(1)

      rec = ExportControlClearance.last
      expect(rec.user_agent).to eq(ua)
      expect(rec).not_to be_passed
      expect(response).to redirect_to(export_control_clearance_denied_path)
    end

    it "passes the User-Agent through to the provider's evidence context" do
      ua = "SeqtoidTest/2.0"
      captured = nil
      allow(ExportControl::DeniedPartyScreeningProvider).to receive(:screen) do |_user, ctx|
        captured = ctx
        screen_result(ExportControlClearance::SCREENING_PENDING)
      end

      post export_control_clearances_path, headers: { "HTTP_USER_AGENT" => ua }

      expect(captured[:user_agent]).to eq(ua)
      expect(response).to redirect_to(export_control_clearance_denied_path)
    end

    it "records the truncated User-Agent on the failed row when the provider RAISES" do
      allow(ExportControl::DeniedPartyScreeningProvider).to receive(:screen)
        .and_raise(StandardError, "vendor timeout")

      expect do
        post export_control_clearances_path, headers: { "HTTP_USER_AGENT" => long_user_agent }
      end.to change(ExportControlClearance, :count).by(1)

      rec = ExportControlClearance.last
      expect(rec.screening_result).to eq(ExportControlClearance::SCREENING_PENDING)
      expect(rec.user_agent.length).to eq(1024)
      expect(response).to redirect_to(export_control_clearance_denied_path)
    end
  end
end

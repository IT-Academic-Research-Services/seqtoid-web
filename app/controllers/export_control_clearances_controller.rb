# CZID-285 — Layer 3 identity-verification + export-screening clearance flow.
#
#   GET  new      → start the clearance: explain IDV + screening is required, hand off to the IDV vendor.
#                   TODO(counsel): the copy is counsel-owned.
#   POST create   → run IDV verify + denied-party screening through the provider-agnostic adapters, record
#                   the outcome as an append-only evidence row, then route (passed → app, else → denied).
#   POST callback → the IDV vendor's async callback/webhook. Verify the provider signature; on ANY
#                   mismatch → deny (record a failed row, never trust an unverified callback).
#   GET  denied   → the non-bypassable deny UX. No "continue anyway" affordance.
#
# EXEMPT from the Layer-3 gate (see ExportControlLayer3Gate) — otherwise the gate would redirect-loop and
# the user could never clear. Still requires authentication.
#
# FAIL-CLOSED throughout: a provider raise, a non-"verified" IDV status, a non-"clear" screening result, a
# bad callback signature, or a failed record write all result in a NON-passed row and the deny path. There
# is no branch that lets an uncertain user through.
class ExportControlClearancesController < ApplicationController
  before_action :disable_header_navigation
  # The IDV vendor's callback is server-to-server (no CSRF token, no session) and authenticates itself via
  # a provider signature we verify in verify_idv_callback_signature!. TODO(vendor): confirm the exact
  # header/scheme per the chosen vendor.
  skip_before_action :verify_authenticity_token, only: :callback

  # Show the click-through / hand-off. If already cleared, don't nag — send them home.
  def new
    if ExportControlClearance.current_clearance_satisfied?(current_user)
      redirect_to root_path and return
    end

    @clearance_version = ExportControlClearance::CURRENT_VERSION
    @idv_provider = ExportControl::IdentityVerificationProvider::PROVIDER
    @show_blank_header = true
    render :new
  end

  # Run IDV + screening and record the outcome. ALWAYS persist a row (passed OR not) — a failure/hit is
  # itself compliance evidence (design doc §6 / CZID-331).
  def create
    verification = ExportControl::IdentityVerificationProvider.verify(current_user, request_evidence_ctx)
    screening    = ExportControl::DeniedPartyScreeningProvider.screen(current_user, request_evidence_ctx)

    clearance = record_clearance(verification, screening)

    if clearance.passed?
      redirect_to root_path
    else
      redirect_to export_control_clearance_denied_path
    end
  rescue StandardError => e
    # FAIL-CLOSED: any provider error/timeout → record a failed row (best-effort) and deny. We never let
    # an exception fall through to an allow.
    Rails.logger.error("[ExportControlClearance] provider error: #{e.message}")
    record_provider_error
    redirect_to export_control_clearance_denied_path
  end

  # IDV vendor async callback/webhook. Verify the provider signature FIRST; a mismatch → deny (record a
  # failed row, respond 403). Only a verified callback may record a passing verification.
  def callback
    unless verify_idv_callback_signature!
      Rails.logger.warn("[ExportControlClearance] rejected callback: signature mismatch")
      head :forbidden and return
    end

    # TODO(vendor): map the verified callback payload onto VERIFICATION_STATUSES + a fresh screen. Until a
    # real vendor is wired, a verified-signature callback still yields the reference stub's PENDING (deny).
    verification = ExportControl::IdentityVerificationProvider.verify(callback_user, request_evidence_ctx)
    screening    = ExportControl::DeniedPartyScreeningProvider.screen(callback_user, request_evidence_ctx)
    record_clearance(verification, screening, user: callback_user)
    head :ok
  end

  # The deny UX — clear, non-bypassable. The only paths out are to retry clearance or to sign out.
  # TODO(counsel): the denial copy is counsel-owned.
  def denied
    @show_blank_header = true
    render :denied, status: :forbidden
  end

  private

  # Persist an append-only clearance evidence row from the two provider results.
  def record_clearance(verification, screening, user: current_user)
    ExportControlClearance.create!(
      user: user,
      verification_status: verification.status,
      screening_result: screening.result,
      idv_provider: verification.provider,
      screening_provider: screening.provider,
      idv_evidence_ref: verification.evidence_ref,
      screening_evidence_ref: screening.evidence_ref,
      clearance_version: ExportControlClearance::CURRENT_VERSION,
      ip_address: request.remote_ip,
      viewer_country: request.headers["CloudFront-Viewer-Country"],
      user_agent: request.user_agent&.slice(0, 1024)
    )
  end

  # Record an explicit failed/failed row when a provider raised — so the deny is evidenced, not silent.
  def record_provider_error
    ExportControlClearance.create!(
      user: current_user,
      verification_status: ExportControlClearance::VERIFICATION_FAILED,
      screening_result: ExportControlClearance::SCREENING_PENDING,
      idv_provider: ExportControl::IdentityVerificationProvider::PROVIDER,
      screening_provider: ExportControl::DeniedPartyScreeningProvider.provider_name,
      clearance_version: ExportControlClearance::CURRENT_VERSION,
      ip_address: request.remote_ip,
      viewer_country: request.headers["CloudFront-Viewer-Country"],
      user_agent: request.user_agent&.slice(0, 1024)
    )
  rescue StandardError => e
    # Even the evidence write failed; log and still deny (the caller redirects to denied).
    Rails.logger.error("[ExportControlClearance] could not record provider error: #{e.message}")
  end

  # Verify the IDV vendor's callback signature. FAIL-CLOSED: no shared secret configured, a missing
  # header, or a mismatch all return false (→ deny). TODO(vendor): implement the exact HMAC/JWS scheme the
  # chosen vendor uses; this is the neutral, deny-by-default skeleton.
  def verify_idv_callback_signature!
    secret = idv_callback_secret
    return false if secret.blank? # no secret wired → cannot verify → deny

    provided = request.headers["X-Export-Control-Signature"].to_s
    return false if provided.blank?

    expected = OpenSSL::HMAC.hexdigest("SHA256", secret, request.raw_post)
    ActiveSupport::SecurityUtils.secure_compare(provided, expected)
  rescue StandardError => e
    Rails.logger.error("[ExportControlClearance] callback signature check error: #{e.message}")
    false
  end

  # TODO(counsel/vendor): source the callback signing secret from the secrets store once the vendor is
  # chosen. Returns nil today → every callback fails the signature check (fail-closed).
  def idv_callback_secret
    nil
  end

  # The user a verified callback pertains to. TODO(vendor): resolve from the vendor payload's reference id.
  # Falls back to current_user for the synchronous flow; nil in a pure webhook until wired (→ record fails).
  def callback_user
    current_user
  end

  def request_evidence_ctx
    {
      ip_address: request.remote_ip,
      viewer_country: request.headers["CloudFront-Viewer-Country"],
      user_agent: request.user_agent&.slice(0, 1024),
    }
  end
end

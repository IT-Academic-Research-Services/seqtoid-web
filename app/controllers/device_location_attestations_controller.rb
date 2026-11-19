# CZID-286 — Layer 3 device / location attestation (SERVER-SIDE token verification).
#
#   GET  new    → the step-up page that hosts the vendor client SDK. HELD (TODO(vendor)) — the SDK embed
#                 is vendor-specific frontend and is NOT built speculatively. The page documents the
#                 integration point; the real SDK + token collection land when the vendor is chosen.
#   POST create → receive the signed attestation token the client SDK produced, VERIFY it server-side via
#                 the provider-agnostic DeviceLocationProvider (signature + freshness + anti-spoof), record
#                 the outcome as an append-only evidence row, then route (verified → app, else → denied).
#   GET  denied → the non-bypassable deny UX.
#
# EXEMPT from the Layer-3 gate (see ExportControlLayer3Gate) — otherwise a user could never attest. Still
# requires authentication.
#
# FAIL-CLOSED: a nil/blank/expired/spoofed/malformed token, a bad signature, or a provider raise all yield
# a NON-verified row and the deny path. Only an affirmatively "verified" token reaches the app.
class DeviceLocationAttestationsController < ApplicationController
  before_action :disable_header_navigation

  def new
    if DeviceLocationAttestation.current_attestation_satisfied?(current_user, ip_address: request.remote_ip)
      redirect_to root_path and return
    end

    @attestation_policy_version = DeviceLocationAttestation::CURRENT_VERSION
    @device_provider = ExportControl::DeviceLocationProvider.provider_name
    prepare_geocomply if @device_provider == "geocomply"
    @show_blank_header = true
    render :new
  end

  # Verify the client-supplied attestation token server-side and record the outcome.
  def create
    result = ExportControl::DeviceLocationProvider.verify_token(params[:attestation_token], request_evidence_ctx)
    attestation = record_attestation(result)

    if attestation.attestation_status == DeviceLocationAttestation::STATUS_VERIFIED
      redirect_to root_path
    else
      redirect_to device_location_attestation_denied_path
    end
  rescue StandardError => e
    # FAIL-CLOSED: any verifier error → record a failed row (best-effort) and deny.
    Rails.logger.error("[DeviceLocationAttestation] verify error: #{e.message}")
    record_failed(DeviceLocationAttestation::FAILURE_PROVIDER_ERROR)
    redirect_to device_location_attestation_denied_path
  end

  def denied
    @show_blank_header = true
    render :denied, status: :forbidden
  end

  private

  # GeoComply's BrowserGuard SDK is loaded from GeoComply's CDN (GEOCOMPLY_CDN_ID), not committed to this
  # public repo. The page authorizes it with a short-lived token we sign for this user's login session.
  # GEOCOMPLY_ENVIRONMENT=staging makes the page select GeoComply's staging environment; anything else is
  # production (the SDK default), so a staging setting can never reach prod by omission.
  def prepare_geocomply
    @geocomply_cdn_id = ENV["GEOCOMPLY_CDN_ID"].presence
    @geocomply_staging = ENV["GEOCOMPLY_ENVIRONMENT"] == "staging"
    @geocomply_auth_token = ExportControl::Providers::Geocomply.authorization_token(
      user_id: current_user.id, session_id: device_location_session_id
    )
  rescue StandardError => e
    # Fail closed: no token means the page shows "not configured" and no check can pass.
    Rails.logger.error("[DeviceLocationAttestation] could not sign GeoComply token: #{e.message}")
    @geocomply_auth_token = nil
  end

  # Our login-session id for GeoComply (ctx.session_id / user_session_id). Lives in the Rails session, which
  # is reset at logout, so it spans exactly one login.
  def device_location_session_id
    session[:device_location_session_id] ||= SecureRandom.uuid
  end

  def record_attestation(result)
    DeviceLocationAttestation.create!(
      user: current_user,
      attestation_status: result.status,
      failure_reason: result.failure_reason,
      device_provider: result.provider,
      attestation_ref: result.attestation_ref,
      asserted_country: result.asserted_country,
      attestation_policy_version: DeviceLocationAttestation::CURRENT_VERSION,
      ip_address: request.remote_ip,
      viewer_country: request.headers["CloudFront-Viewer-Country"],
      user_agent: request.user_agent&.slice(0, 1024)
    )
  end

  def record_failed(reason)
    DeviceLocationAttestation.create!(
      user: current_user,
      attestation_status: DeviceLocationAttestation::STATUS_FAILED,
      failure_reason: reason,
      device_provider: ExportControl::DeviceLocationProvider.provider_name,
      attestation_policy_version: DeviceLocationAttestation::CURRENT_VERSION,
      ip_address: request.remote_ip,
      viewer_country: request.headers["CloudFront-Viewer-Country"],
      user_agent: request.user_agent&.slice(0, 1024)
    )
  rescue StandardError => e
    Rails.logger.error("[DeviceLocationAttestation] could not record failure: #{e.message}")
  end

  def request_evidence_ctx
    {
      user_id: current_user&.id,
      session_id: session[:device_location_session_id],
      ip_address: request.remote_ip,
      viewer_country: request.headers["CloudFront-Viewer-Country"],
      user_agent: request.user_agent&.slice(0, 1024),
    }
  end
end

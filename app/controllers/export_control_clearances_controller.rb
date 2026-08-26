# CZID-285 -- Layer 3 export-screening clearance flow.
#
# Approval model (legal-approved 2026-08-24 -- export-control-approval-vc-only): user clearance is
# ATTESTATION (CZID-330, a separate gate) + denied-party SCREENING (Visual Compliance / Descartes). There
# is NO document identity-verification (IDV) step. This controller runs the SCREENING half and records the
# outcome as append-only evidence.
#
#   GET  new     -> start the clearance: explain screening is required, hand off to the screen.
#                  TODO(counsel): the copy is counsel-owned.
#   POST create  -> run denied-party screening through the provider-agnostic adapter, record the outcome as
#                  an append-only evidence row, then route (clear -> app, else -> denied).
#   GET  denied  -> the non-bypassable deny UX. No "continue anyway" affordance.
#
# EXEMPT from the Layer-3 gate (see ExportControlLayer3Gate) -- otherwise the gate would redirect-loop and
# the user could never clear. Still requires authentication.
#
# FAIL-CLOSED throughout: a provider raise, a non-"clear" screening result, or a failed record write all
# result in a NON-passed row and the deny path. There is no branch that lets an uncertain user through.
class ExportControlClearancesController < ApplicationController
  before_action :disable_header_navigation

  # Show the click-through / hand-off. If already cleared, don't nag -- send them home.
  def new
    if ExportControlClearance.current_clearance_satisfied?(current_user)
      redirect_to root_path and return
    end

    @clearance_version = ExportControlClearance::CURRENT_VERSION
    @show_blank_header = true
    render :new
  end

  # Run screening and record the outcome. ALWAYS persist a row (clear OR not) -- a hit is itself compliance
  # evidence (design doc section 6 / CZID-331).
  def create
    screening = ExportControl::DeniedPartyScreeningProvider.screen(current_user, request_evidence_ctx)

    clearance = record_clearance(screening)

    if clearance.passed?
      redirect_to root_path
    else
      redirect_to export_control_clearance_denied_path
    end
  rescue StandardError => e
    # FAIL-CLOSED: any provider error/timeout -> record a failed row (best-effort) and deny. We never let
    # an exception fall through to an allow.
    Rails.logger.error("[ExportControlClearance] provider error: #{e.message}")
    record_provider_error
    redirect_to export_control_clearance_denied_path
  end

  # The deny UX -- clear, non-bypassable. The only paths out are to retry clearance or to sign out.
  # TODO(counsel): the denial copy is counsel-owned.
  def denied
    @show_blank_header = true
    render :denied, status: :forbidden
  end

  private

  # Persist an append-only clearance evidence row from the screening result.
  def record_clearance(screening, user: current_user)
    ExportControlClearance.create!(
      user: user,
      screening_result: screening.result,
      screening_provider: screening.provider,
      screening_evidence_ref: screening.evidence_ref,
      clearance_version: ExportControlClearance::CURRENT_VERSION,
      ip_address: request.remote_ip,
      viewer_country: request.headers["CloudFront-Viewer-Country"],
      user_agent: request.user_agent&.slice(0, 1024)
    )
  end

  # Record an explicit pending/failed row when a provider raised -- so the deny is evidenced, not silent.
  def record_provider_error
    ExportControlClearance.create!(
      user: current_user,
      screening_result: ExportControlClearance::SCREENING_PENDING,
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

  def request_evidence_ctx
    {
      ip_address: request.remote_ip,
      viewer_country: request.headers["CloudFront-Viewer-Country"],
      user_agent: request.user_agent&.slice(0, 1024),
    }
  end
end

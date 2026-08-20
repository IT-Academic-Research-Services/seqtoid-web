# CZID-599 (Export-control Layer 3 / #285) -- the LIVE restricted-party SCREENING gate. This is the
# ticket that adds the FIRST real caller of ExportControl::ScreeningService, at the two
# counsel-recommended points (design doc #595, Section 9, Q1 = (a)+(c)):
#   - ONBOARDING backstop     -- screen the signed-in user (screen-once-and-periodic; re-running the
#                                before_action supports periodic re-screen).
#   - RESULT-RELEASE backstop -- screen before a result is released/downloaded.
#
# ================= PROVABLY INERT WHEN DISABLED (the whole point of this ticket) =================
# Every hook FIRST calls export_control_screening_gate_active?, which is false unless
# AppConfig::ENABLE_EXPORT_CONTROL_LAYER3 == "1" (the MASTER flag, default OFF). On false the hook
# EARLY-RETURNS before building any subject or even referencing ScreeningService -- a full PASS-THROUGH,
# byte-for-byte identical to the feature not existing. It is NOT "enabled but denying".
#
# Two more dark layers stack on top:
#   - the per-point toggles (ENABLE_EXPORT_CONTROL_SCREEN_ONBOARDING / _RELEASE, both default OFF): even
#     with the master flag on, a point stays a pass-through until its own toggle is on.
#   - ScreeningService#screen_if_enabled is itself gated by ENABLE_DESCARTES_SCREENING and returns nil
#     (no client, no network, no rows) when that is off -- and a nil outcome is ALSO a pass-through here.
# Triple-dark: ZERO upstream impact on the user path until counsel + the license flip all the flags.
#
# ================= FAIL-CLOSED (only once the flags are ON) =================
# When active AND screening returns a real outcome, ONLY an :allowed (clean Descartes "Passed") outcome
# proceeds. A :held (hit) or :error (transport/timeout/config/unknown) outcome BLOCKS, fail-closed: HTML
# is redirected to the clearance flow, non-HTML gets 403. There is no allow-on-uncertainty path.
module ExportControlScreeningGate
  extend ActiveSupport::Concern

  # NOTE: this concern does NOT auto-install its before_actions. The consuming controllers wire them
  # explicitly (ApplicationController: onboarding; BulkDownloadsController: release) so the ordering and
  # the exact gate points are visible in one place.

  # Same exemption discipline as the Layer 3 gate: never gate the clearance / attestation / auth
  # controllers, or a not-yet-cleared user could never reach the flow that would clear them.
  SCREENING_GATE_EXEMPT_CONTROLLERS = %w[
    export_control_clearances
    device_location_attestations
    export_control_attestations
    auth0
  ].freeze

  private

  # ---- onboarding gate point (wired as a before_action on ApplicationController) ----
  def screen_export_control_onboarding
    enforce_export_control_screen(
      point_enabled: onboarding_screen_gate_enabled?,
      redirect_path: new_export_control_clearance_path
    )
  end

  # ---- result-release backstop (wired as a before_action on the download controller) ----
  def screen_export_control_release
    enforce_export_control_screen(
      point_enabled: release_screen_gate_enabled?,
      redirect_path: export_control_clearance_denied_path
    )
  end

  # THE BYPASS. Read FIRST in every hook; when the master flag is off the hook is a complete no-op.
  def export_control_screening_gate_active?
    get_app_config(AppConfig::ENABLE_EXPORT_CONTROL_LAYER3) == "1"
  end

  def onboarding_screen_gate_enabled?
    get_app_config(AppConfig::ENABLE_EXPORT_CONTROL_SCREEN_ONBOARDING) == "1"
  end

  def release_screen_gate_enabled?
    get_app_config(AppConfig::ENABLE_EXPORT_CONTROL_SCREEN_RELEASE) == "1"
  end

  # The shared hook body. The ORDER of the guards is load-bearing for "inert when disabled":
  #   1. master flag off        -> return (no-op)                 <-- the hand-verified BYPASS
  #   2. this point toggle off  -> return (no-op)
  #   3. no current_user        -> return (auth owns anonymous)
  #   4. exempt controller      -> return
  #   5. screen_if_enabled nil  -> return (Descartes flag off; NO live call was made -> pass-through)
  #   6. outcome allowed        -> return (clean "Passed" screen)
  #   7. otherwise              -> BLOCK (fail-closed)
  def enforce_export_control_screen(point_enabled:, redirect_path:)
    return unless export_control_screening_gate_active?
    return unless point_enabled
    return if current_user.nil?
    return if screening_gate_exempt_request?

    outcome = ExportControl::ScreeningService.new.screen_if_enabled(current_user_screening_subject)
    return if outcome.nil?      # screening disabled -> nothing was called -> full pass-through
    return if outcome.allowed?  # clean screen -> proceed

    deny_export_control_screening(redirect_path)
  end

  # Build the screening subject from the signed-in user. soptionalid is TABLE-KEYED to users.id
  # (Compliance Manager requires "0" or a table-keyed reference, never a random GUID).
  def current_user_screening_subject
    ExportControl::ScreeningService::Subject.new(
      subject_ref: "User:#{current_user.id}",
      subject_type: "User",
      name: current_user.name,
      soptionalid: current_user.id.to_s,
      # Generic (country-level) location so the vendor can populate risk_country for
      # high-risk-jurisdiction detection. CloudFront-Viewer-Country is an ISO-3166 alpha-2
      # derived from the request geo -- country granularity only, never a precise address.
      country: request.headers["CloudFront-Viewer-Country"].presence,
      # SMP-1684: email is used ONLY for the ScreeningPolicy whitelist domain match (e.g. "ucsf.edu");
      # it is never sent to the vendor and never logged.
      email: current_user.email
    )
  end

  def screening_gate_exempt_request?
    SCREENING_GATE_EXEMPT_CONTROLLERS.include?(controller_name) ||
      (respond_to?(:disabled_for_maintenance?, true) && disabled_for_maintenance?)
  end

  # Fail-closed routing: HTML to the clearance/denied flow, everything else (API/JSON/XHR) a 403.
  def deny_export_control_screening(redirect_path)
    respond_to do |format|
      format.html { redirect_to redirect_path }
      format.any do
        render json: { errors: ["Export-control screening hold"] }, status: :forbidden
      end
    end
  end
end

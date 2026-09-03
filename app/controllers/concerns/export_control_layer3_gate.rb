# CZID-285/286 — the Layer 3 export-control gate (identity verification + export screening, and — when
# the device-attestation policy requires it — device/location attestation).
#
# A before_action (installed on ApplicationController, AFTER authentication AND after the CZID-330
# attestation gate) that, WHEN ENFORCEMENT IS ENABLED, requires every logged-in user to hold a current,
# affirmatively-passed export-control clearance before reaching the app. This is the app-layer companion
# to the network-layer Layers 1–2 (geo/VPN) and the click-through attestation (CZID-330); it does not
# replace them — it is the deepest, true-origin layer (design doc EXPORT-CONTROL-LAYER3-DESIGN.md).
#
# FAIL-CLOSED intent (zero-tolerance): when enforcement is ON, the ONLY way past this gate is an
# affirmative current clearance — IDV verified AND screening clear. ANY other state DENIES:
#   - nil user (defense-in-depth; auth runs upstream)         => deny
#   - no clearance record                                     => deny
#   - verification pending/failed                             => deny
#   - screening pending/hit                                   => deny
#   - stale clearance version                                 => deny
#   - provider error (recorded as a non-passed row)           => deny
# There is no allow-on-uncertainty path. (Device attestation, CZID-286, is gated in the SAME fail-closed
# way but only when its policy flag requires it — see device_location_attestation_required?.)
#
# Enforcement is OFF by default (AppConfig::ENABLE_EXPORT_CONTROL_LAYER3 != "1") so this ships DARK.
# Go-live is a counsel-gated flag flip (CZID-292/278/335), never an engineering decision.
#
# TODO(counsel): the data-classification that decides WHEN a clearance is required (deemed-export scope)
# and the user-facing copy live outside this gate and are counsel-owned.
module ExportControlLayer3Gate
  extend ActiveSupport::Concern

  # NOTE: this concern does NOT auto-install its before_action. ApplicationController wires
  # `before_action :require_export_control_layer3` explicitly, right after the CZID-330 attestation gate,
  # so the ordering (authenticate → maintenance → attestation → layer3) is visible in one place.

  private

  # True only when the operator has explicitly enabled Layer 3 enforcement. Off by default = ship dark.
  def export_control_layer3_enforced?
    get_app_config(AppConfig::ENABLE_EXPORT_CONTROL_LAYER3) == "1"
  end

  # True only when the operator has ALSO turned on device/location attestation (CZID-286). Independently
  # dark: even with Layer 3 on, device attestation is required only when this second flag is on AND the
  # request is in scope. Both default OFF. TODO(counsel/product): which flows require device attestation.
  def device_location_attestation_required?
    get_app_config(AppConfig::ENABLE_EXPORT_CONTROL_DEVICE_ATTESTATION) == "1"
  end

  # Paths the gate must NOT block, or the redirect would loop / the user could never clear:
  #   - the Layer-3 clearance controller itself (start/callback/denied)
  #   - the device-attestation controller (submit/verify the token, deny page)
  #   - the CZID-330 attestation controller (must stay reachable to attest first)
  #   - the auth0 controller (login/logout/token) so a not-yet-cleared user can authenticate / sign out
  # Match on controller name so route changes don't silently open a hole.
  LAYER3_EXEMPT_CONTROLLERS = %w[
    export_control_clearances
    device_location_attestations
    export_control_attestations
    export_control_signups
    auth0
  ].freeze

  def require_export_control_layer3
    return unless export_control_layer3_enforced?
    # Only gate authenticated sessions — anonymous requests are handled by authenticate_user! upstream.
    # (nil user is still fail-closed at the model predicate; this early return just avoids gating the
    #  anonymous flows that auth already owns.)
    return if current_user.nil?
    return if layer3_exempt_request?

    # #285 — identity verification + export screening. Fail-closed: only an affirmative current clearance
    # (verified AND clear) passes.
    unless ExportControlClearance.current_clearance_satisfied?(current_user)
      return deny_layer3(reason: :clearance_required, denied_path: export_control_clearance_denied_path,
                         start_path: new_export_control_clearance_path)
    end

    # #286 — device/location attestation, only when the policy flag requires it (independently dark).
    if device_location_attestation_required? &&
       !DeviceLocationAttestation.current_attestation_satisfied?(current_user)
      return deny_layer3(reason: :device_attestation_required,
                         denied_path: device_location_attestation_denied_path,
                         start_path: new_device_location_attestation_path)
    end

    nil
  end

  # Route an un-cleared user to the right screen (fail-closed on both HTML and non-HTML). HTML gets the
  # click-through / step-up start page; API/JSON/XHR cannot show one, so they are DENIED outright.
  def deny_layer3(reason:, denied_path:, start_path:)
    respond_to do |format|
      format.html { redirect_to start_path }
      format.any do
        render json: { errors: ["Export-control clearance required (#{reason})"] }, status: :forbidden
      end
    end
  end

  def layer3_exempt_request?
    LAYER3_EXEMPT_CONTROLLERS.include?(controller_name) ||
      (respond_to?(:disabled_for_maintenance?, true) && disabled_for_maintenance?)
  end
end

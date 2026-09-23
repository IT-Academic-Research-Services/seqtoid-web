# CZID-330 — the export-control / Terms-of-Use attestation gate.
#
# A before_action (installed on ApplicationController, AFTER authentication) that, WHEN ENFORCEMENT IS
# ENABLED, requires every logged-in user to have a current accepted attestation before reaching the app.
# Un-attested users are redirected to the click-through attestation page; users whose latest decision is
# "declined" get the deny UX. This is the app-layer companion to the network-layer geo/VPN enforcement
# (Layers 1-2); it does not replace them.
#
# Fail-closed intent (CZID-330): when enforcement is ON, the ONLY way past this gate is an affirmative
# current accepted attestation. Any ambiguity (no record, declined, stale version) keeps the user out.
#
# Enforcement is OFF by default (AppConfig::ENABLE_EXPORT_CONTROL_ATTESTATION != "1") so this ships DARK.
# Go-live is a counsel-gated flag flip (CZID-292/335), never an engineering decision.
#
# TODO(counsel): the attestation copy + the deny copy live in the views and are counsel-owned.
module ExportControlAttestationGate
  extend ActiveSupport::Concern

  # NOTE: this concern does NOT auto-install its before_action. ApplicationController wires
  # `before_action :require_export_control_attestation` explicitly, right after :check_for_maintenance,
  # so the ordering (authenticate → maintenance → attestation gate) is visible in one place.

  private

  # True only when the operator has explicitly enabled enforcement. Off by default = ship dark.
  def export_control_attestation_enforced?
    get_app_config(AppConfig::ENABLE_EXPORT_CONTROL_ATTESTATION) == "1"
  end

  # The paths the gate must NOT block, or the redirect would loop / the user could never attest:
  #   - the attestation controller itself (show the form, record the decision, show the deny page)
  #   - the auth0 controller (login/logout/token) so an un-attested user can still authenticate/sign out
  # Everything else is gated. We match on controller name so route changes don't silently open a hole.
  ATTESTATION_EXEMPT_CONTROLLERS = %w[
    export_control_attestations
    export_control_signups
    auth0
  ].freeze

  def require_export_control_attestation
    return unless export_control_attestation_enforced?
    # Only gate authenticated sessions — anonymous requests are handled by authenticate_user! upstream.
    return if current_user.nil?
    return if attestation_exempt_request?

    return if ExportControlAttestation.current_attestation_satisfied?(current_user)

    # Not satisfied → route to the right screen. A prior explicit decline gets the deny UX; a user who
    # simply has not attested yet gets the click-through form. Both live under the attestation controller.
    respond_to do |format|
      format.html do
        if ExportControlAttestation.latest_decision_declined?(current_user)
          redirect_to export_control_denied_path
        else
          redirect_to new_export_control_attestation_path
        end
      end
      # Non-HTML (API/JSON/XHR) requests cannot show a click-through, so they are DENIED outright while
      # the gate is unsatisfied — fail-closed. The client must complete the HTML attestation first.
      format.any do
        render json: { errors: ["Export-control attestation required"] }, status: :forbidden
      end
    end
  end

  def attestation_exempt_request?
    ATTESTATION_EXEMPT_CONTROLLERS.include?(controller_name) ||
      # maintenance + health/landing paths already have their own handling; never gate the maintenance page.
      (respond_to?(:disabled_for_maintenance?, true) && disabled_for_maintenance?)
  end
end

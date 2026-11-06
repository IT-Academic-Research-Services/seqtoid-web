# Standalone device-location check (GeoComply staging test).
#
# The CZID-286 device check inside ExportControlLayer3Gate only runs after a full export-control clearance,
# so it cannot be turned on without turning on all of Layer 3 and locking out everyone who has no
# clearance. This gate runs the device check ON ITS OWN, for an explicit list of users only:
#
#   AppConfig::ENABLE_DEVICE_LOCATION_CHECK  "1" turns it on (default OFF -- ships dark)
#   AppConfig::DEVICE_LOCATION_CHECK_USERS   JSON array of user ids / emails, or ["*"] for everyone.
#                                            Blank/unset/unparseable => nobody is in scope.
#
# In scope + no current verified attestation => HTML is redirected to the attestation page; anything else
# (JSON/XHR, CLI) gets a 403, same as the Layer 3 gate. Out of scope => untouched.
#
# FAIL-CLOSED for in-scope users: only a current, verified, unexpired attestation (from the same IP when the
# IP re-check is on) lets them through. See DeviceLocationAttestation.current_attestation_satisfied?.
module ExportControlDeviceLocationGate
  extend ActiveSupport::Concern

  # Wired explicitly in ApplicationController, after the Layer 3 gate.

  ALL_USERS = "*".freeze

  # Same reasons as ExportControlLayer3Gate::LAYER3_EXEMPT_CONTROLLERS: the attestation page itself, the
  # other export-control flows and auth0 must stay reachable or the user could never pass or sign out.
  DEVICE_LOCATION_EXEMPT_CONTROLLERS = %w[
    device_location_attestations
    export_control_clearances
    export_control_attestations
    export_control_signups
    auth0
  ].freeze

  private

  def require_device_location_check
    return unless device_location_check_enabled?
    return if current_user.nil?
    return if device_location_exempt_request?
    return unless device_location_check_applies_to?(current_user)
    return if DeviceLocationAttestation.current_attestation_satisfied?(current_user, ip_address: request.remote_ip)

    respond_to do |format|
      format.html { redirect_to new_device_location_attestation_path }
      format.any do
        render json: { errors: ["Device location verification required"] }, status: :forbidden
      end
    end
  end

  def device_location_check_enabled?
    get_app_config(AppConfig::ENABLE_DEVICE_LOCATION_CHECK) == "1"
  end

  def device_location_check_applies_to?(user)
    entries = device_location_check_users
    return true if entries.include?(ALL_USERS)

    entries.include?(user.id.to_s) || entries.include?("user:#{user.id}") ||
      (user.email.present? && entries.include?(user.email.downcase))
  end

  # Normalised to lowercase strings. Anything that is not a JSON array => [] (nobody in scope).
  def device_location_check_users
    raw = get_app_config(AppConfig::DEVICE_LOCATION_CHECK_USERS)
    return [] if raw.blank?

    parsed = JSON.parse(raw)
    parsed.is_a?(Array) ? parsed.map { |e| e.to_s.strip.downcase } : []
  rescue JSON::ParserError
    []
  end

  def device_location_exempt_request?
    DEVICE_LOCATION_EXEMPT_CONTROLLERS.include?(controller_name) ||
      (respond_to?(:disabled_for_maintenance?, true) && disabled_for_maintenance?)
  end
end

# CZID-285 — the provider-agnostic IDV/KYC contract (the swap point), mirroring the Layer-2 edge adapter
# (cypherid-web-infra edge-ip-intel/lambda/adapter/index.mjs). The gate + controller consume ONLY this
# interface; selecting the vendor = changing PROVIDER + wiring its secret, nothing else.
#
# TODO(counsel/vendor): the FINAL IDV vendor (Persona / Onfido / Jumio / Stripe Identity / ID.me — all
# pluggable behind this interface) is counsel + procurement's choice, gated on the DPA. The committed
# PROVIDER is a reference stub that returns PENDING (never a synthetic pass) so the gate stays fail-closed
# until a real vendor is wired.
#
# Contract — verify(user, ctx) returns a Result:
#   status:        one of ExportControlClearance::VERIFICATION_STATUSES (verified/failed/pending)
#   provider:      the provider name, for the CZID-331 evidence record
#   evidence_ref:  opaque vendor reference (inquiry id / session id) — NOT raw PII/documents
#
# FAIL-CLOSED: any provider error/timeout MUST surface as a raise or a non-"verified" status. The caller
# treats anything that is not an affirmative "verified" as deny. A provider must NEVER return "verified"
# on uncertainty.
module ExportControl
  module IdentityVerificationProvider
    # Immutable result the gate/controller consume. Kept minimal + provider-neutral on purpose.
    Result = Struct.new(:status, :provider, :evidence_ref, keyword_init: true)

    # Selected at boot. The committed placeholder is the reference stub. build/deploy wiring (or an ENV/
    # AppConfig, counsel-gated) swaps in the chosen vendor — mirrors the edge adapter's PROVIDER_NAME.
    # TODO(counsel/vendor): set to the procurement-chosen vendor once its DPA + keys are in place.
    PROVIDER = "reference_stub".freeze

    module_function

    # Resolve + delegate to the configured provider module. Provider modules implement `.verify`.
    #
    # WHITELIST FIRST: a counsel-cleared identity is VERIFIED with no vendor call, mirroring the
    # denied-party screening whitelist (ScreeningPolicy). This is the ONLY affirmative-"verified" path
    # until a real IDV vendor is wired -- without it verify() can only ever PENDING (the reference stub),
    # so NO user can clear the gate (passed? = verified AND clear) and the platform admits nobody. This
    # is NOT an allow-on-uncertainty: it is an EXPLICIT counsel clearance recorded in AppConfig. Empty/
    # unset allow-table verifies NOBODY (fail-closed default), exactly like the screening whitelist.
    def verify(user, ctx = {})
      if whitelisted?(user)
        return Result.new(status: ExportControlClearance::VERIFICATION_VERIFIED, provider: "whitelist", evidence_ref: nil)
      end

      provider_module.verify(user, ctx)
    end

    # True only if this user is on the counsel-cleared IDV allow-table (EXPORT_CONTROL_IDV_WHITELIST),
    # matched by subject_ref ("User:<id>") or by email domain, case-insensitive -- the same semantics as
    # ScreeningPolicy.whitelisted?. Blank/unset => false (nobody), so the gate stays fail-closed.
    def whitelisted?(user)
      return false if user.nil?

      entries = Array(AppConfigHelper.get_json_app_config(AppConfig::EXPORT_CONTROL_IDV_WHITELIST, []))
                .map { |entry| entry.to_s.downcase.strip }.reject(&:blank?)
      return false if entries.empty?

      ref = "user:#{user.id}".downcase.strip
      return true if entries.include?(ref)

      domain = user.try(:email).to_s.downcase.strip.split("@").last
      return false if domain.blank?

      entries.any? { |e| e == domain || e == "@#{domain}" }
    end

    def provider_module
      case PROVIDER
      when "persona"        then Providers::Persona
      when "onfido"         then Providers::Onfido
      # when "jumio", "stripe_identity", "id_me" → add the module when that vendor is chosen (TODO(vendor)).
      else
        Providers::ReferenceStub
      end
    end
  end
end

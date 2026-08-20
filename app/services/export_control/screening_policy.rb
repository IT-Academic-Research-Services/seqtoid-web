# frozen_string_literal: true

# CZID-600 (Export-control Layer 3 / #285) -- the CONFIG + SECRETS-plumbing layer for Descartes
# restricted-party screening. Counsel's operational decisions (which lists/groups to search, the
# known-good whitelist, the re-screen cadence, the hit-handling policy) are read from AppConfig / ENV at
# runtime so they are drop-in without a code deploy. Secrets (ssecno/spassword/endpoint) are read from
# ENV/Chamber/SSM; NO secret VALUES live in this repo.
#
# ============================ INERT / FAIL-CLOSED BY DEFAULT ============================
# Every reader here defaults to the conservative choice, so an un-provisioned environment is safe:
#   - rps_groups            -> "" (Descartes profile default; no accidental over-broad scope)
#   - whitelist             -> [] (nobody is auto-allowed past a hold)
#   - rescreen_cadence_days -> 0  (always re-screen)
#   - hit_handling          -> "hold" (never "allow" on a hit)
#   - endpoint / client_config -> nil / unconfigured, so SearchEntityClient stays inert (no network)
# This module has NO live caller wired in; it is the configuration surface the gate (CZID-599) and the
# ScreeningService (CZID-596) read once counsel + the license enable the feature.
#
# ============================ SECRETS OPS MUST PROVISION ============================
# Provision these in Chamber/SSM (surfaced to the app as ENV). Sandbox creds first; production on
# go-live. The VALUES arrive with the Descartes license -> drop-in. NEVER commit values to any repo.
#   DESCARTES_RPS_ENV       -- "sandbox" | "production". Selects the base host below. (Optional if
#                              DESCARTES_RPS_ENDPOINT is set explicitly.)
#   DESCARTES_RPS_ENDPOINT  -- explicit base URL override (wins over DESCARTES_RPS_ENV). e.g.
#                              "https://rpstest.visualcompliance.com".
#   DESCARTES_RPS_SECNO     -- Descartes Security Number (ssecno), max 5 chars. REQUIRED to screen.
#   DESCARTES_RPS_PASSWORD  -- Descartes password (spassword), max 20 chars. REQUIRED to screen.
#   DESCARTES_RPS_GROUPS    -- (optional) srpsgroupbypass fallback if the AppConfig group key is unset.
#   DESCARTES_RPS_LIST_LABEL-- (optional) human label recorded on screening_results.list.
# Until DESCARTES_RPS_ENDPOINT/-ENV AND -SECNO AND -PASSWORD are all present, configured? is false and no
# screen call can be built.
module ExportControl
  module ScreeningPolicy
    module_function

    # ---------------------------------------------------------------------------------------------
    # RPS list-group selection (srpsgroupbypass). Descartes exposes six numeric GROUPS; counsel selects
    # which to search. We accept names or numerals and emit the sorted numeral string the API wants.
    # ---------------------------------------------------------------------------------------------
    GROUP_NUMERALS = {
      'export' => '1', 'munitions' => '2', 'gsa' => '3',
      'police' => '4', 'banking' => '5', 'international' => '6'
    }.freeze

    # ---------------------------------------------------------------------------------------------
    # Sanctioned-jurisdiction backstop (counsel-owned). An association with a sanctioned jurisdiction is
    # a hard HOLD (Hold::REASON_SANCTIONED_JURISDICTION) and RED severity, regardless of name-match or
    # transstatus. ISO-3166 alpha-2. This is Layer B (account/access screening); it MUST stay in parity
    # with the Layer A edge geo-block (WAF rule group *-web-waf-geoblocking, CZID-323) so a party the
    # edge would refuse is also refused an account if they reach screening via an allowlisted IP or a
    # geo-IP-spoofing VPN. Kept equal to that WAF CountryCodes list.
    # TODO(counsel, CZID-322): the authoritative list is counsel-owned -- ratify. RU is a program-specific
    # sanction (not a comprehensive embargo); UA is an intentional over-block standing in for the
    # sub-national Crimea/DNR/LNR programs, which cannot be expressed at country granularity.
    # ---------------------------------------------------------------------------------------------
    SANCTIONED_COUNTRIES = %w[CU IR KP RU SY UA].freeze

    # True when the screened party's country is on the in-house embargo list. Blank => false (the
    # vendor's risk_country flag is the other half of the jurisdiction signal; see ScreeningService).
    def sanctioned_country?(country)
      code = country.to_s.strip.upcase
      return false if code.empty?

      SANCTIONED_COUNTRIES.include?(code)
    end

    # The srpsgroupbypass string, e.g. "12" for Export+Munitions. "" => Descartes profile default.
    def rps_groups
      raw = AppConfigHelper.get_app_config(AppConfig::EXPORT_CONTROL_RPS_GROUPS).presence ||
            ENV['DESCARTES_RPS_GROUPS'].presence
      normalize_groups(raw)
    end

    # Parse "Export, Munitions" / "export|munitions" / "12" -> "12". Unknown tokens are dropped.
    def normalize_groups(raw)
      return '' if raw.blank?

      numerals = raw.to_s.split(/[\s,|]+/).reject(&:blank?).filter_map do |token|
        t = token.downcase
        GROUP_NUMERALS[t] || (t.match?(/\A[1-6]\z/) ? t : nil)
      end
      numerals.uniq.sort.join
    end

    # ---------------------------------------------------------------------------------------------
    # Whitelist / allow-table (the WL/AL known-good mechanism). Institutional users counsel has cleared,
    # to suppress recurring false positives. Empty => nobody (fail-closed).
    # ---------------------------------------------------------------------------------------------
    def whitelist
      list = AppConfigHelper.get_json_app_config(AppConfig::EXPORT_CONTROL_SCREENING_WHITELIST, [])
      Array(list).map { |entry| entry.to_s.downcase.strip }.reject(&:blank?)
    end

    # True only if this subject (by ref, or by the user's email domain) is on the allow-table.
    def whitelisted?(subject_ref, email = nil)
      entries = whitelist
      return false if entries.empty?

      ref = subject_ref.to_s.downcase.strip
      return true if ref.present? && entries.include?(ref)

      domain = email.to_s.downcase.strip.split('@').last
      return false if domain.blank?

      entries.any? { |e| e == domain || e == "@#{domain}" }
    end

    # ---------------------------------------------------------------------------------------------
    # Re-screen cadence. How stale a passing screen may be before a re-screen is due. 0 => always.
    # ---------------------------------------------------------------------------------------------
    def rescreen_cadence_days
      raw = AppConfigHelper.get_app_config(AppConfig::EXPORT_CONTROL_RESCREEN_CADENCE_DAYS)
      days = Integer(raw.to_s, exception: false) || 0
      days.negative? ? 0 : days
    end

    # True when a subject last screened at last_screened_at is due for a fresh screen. nil / cadence 0 =>
    # always due (most conservative).
    def rescreen_due?(last_screened_at)
      return true if last_screened_at.nil?

      days = rescreen_cadence_days
      return true if days.zero?

      last_screened_at <= days.days.ago
    end

    # ---------------------------------------------------------------------------------------------
    # Hit-handling policy. What to do when a screen HOLDs. Never "allow"; default "hold" (fail-closed).
    # ---------------------------------------------------------------------------------------------
    HIT_BLOCK  = 'block'.freeze  # deny the action outright
    HIT_HOLD   = 'hold'.freeze   # place a hold; await human Incident-Manager adjudication (default)
    HIT_REPORT = 'report'.freeze # hold + emit a report signal
    HIT_POLICIES = [HIT_BLOCK, HIT_HOLD, HIT_REPORT].freeze

    def hit_handling
      value = AppConfigHelper.get_app_config(AppConfig::EXPORT_CONTROL_HIT_HANDLING).to_s.downcase.strip
      HIT_POLICIES.include?(value) ? value : HIT_HOLD # fail-closed default
    end

    # ---------------------------------------------------------------------------------------------
    # Endpoint (sandbox vs production) + secrets plumbing. Values come from ENV/Chamber (see header).
    # ---------------------------------------------------------------------------------------------
    ENDPOINTS = {
      'sandbox'    => 'https://rpstest.visualcompliance.com',
      'production' => 'https://rps.visualcompliance.com'
    }.freeze

    # The base endpoint URL, or nil when unset (which keeps the client inert). An explicit
    # DESCARTES_RPS_ENDPOINT wins; otherwise resolve DESCARTES_RPS_ENV ("sandbox"/"production").
    def endpoint
      explicit = ENV['DESCARTES_RPS_ENDPOINT'].presence
      return explicit if explicit

      ENDPOINTS[ENV['DESCARTES_RPS_ENV'].to_s.downcase.strip]
    end

    # A ready-to-use SearchEntityClient::Config assembled from policy + secrets. Drop-in for the
    # ScreeningService client. Stays inert (configured? == false) until endpoint + both creds are set.
    def client_config
      ExportControl::Descartes::SearchEntityClient::Config.new(
        endpoint: endpoint,
        secno: ENV['DESCARTES_RPS_SECNO'],
        password: ENV['DESCARTES_RPS_PASSWORD'],
        groups: rps_groups.presence,
        list_label: ENV['DESCARTES_RPS_LIST_LABEL']
      )
    end

    # True only when the endpoint + both credentials are provisioned. False in any un-provisioned env.
    def configured?
      client_config.configured?
    end
  end
end

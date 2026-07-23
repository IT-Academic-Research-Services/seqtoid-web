# frozen_string_literal: true

require Rails.root.join("lib/taxonomy_rollback_support").to_s

module Internal
  # Chaos Engine accuracy-gate integrity probe (platform-overhaul #810/#815).
  #
  # The chaos-accuracy-probe (deploy/chaos/accuracy-probe/, chaos-mesh namespace) calls
  # GET /internal/chaos/integrity to prove a chaos fault did NOT corrupt reference data -- the
  # correctness half of the dual gate. It reuses TaxonomyRollbackSupport.compute_fingerprint (the same
  # deterministic CHECKSUM TABLE that proves a taxonomy rollback restored the exact prior rows) to compare
  # the current reference tables against a baseline captured at steady state.
  #
  # Subclasses ActionController::Base (NOT ApplicationController) on purpose: none of the user-auth /
  # export-control / attestation before_actions apply. This endpoint authenticates with a shared bearer
  # token, never a user session, and must be reachable by a headless in-cluster caller.
  #
  # FAIL CLOSED: if CHAOS_INTEGRITY_TOKEN is unset the endpoint is DISABLED (503). It never ships open,
  # and it is not routed anywhere a browser session reaches -- only the in-cluster probe calls it.
  class ChaosController < ActionController::Base # rubocop:disable Rails/ApplicationController
    BASELINE_KEY = "chaos_integrity_baseline"

    before_action :require_chaos_token

    # GET /internal/chaos/integrity
    #   (default)     compare current reference-table fingerprints to the stored baseline; integrity_ok
    #                 is true iff every configured table still matches. On the FIRST call (no baseline
    #                 yet -- i.e. steady state at preflight) it captures the baseline and returns ok=true.
    #   ?recapture=1  force a fresh baseline (use right after a legitimate taxonomy load), returns ok=true.
    def integrity
      tables = integrity_tables
      conn = ActiveRecord::Base.connection
      current = tables.index_with do |t|
        TaxonomyRollbackSupport.compute_fingerprint(conn, t)
      end

      baseline_raw = AppConfig.find_by(key: BASELINE_KEY)&.value
      if params[:recapture].present? || baseline_raw.blank?
        store_baseline(current)
        return render(json: { integrity_ok: true, captured: true, tables: current.keys, fingerprints: current })
      end

      baseline = JSON.parse(baseline_raw)
      mismatches = tables.filter_map do |t|
        next if fingerprints_match?(baseline[t], current[t])

        { "table" => t, "expected" => baseline[t], "actual" => current[t] }
      end
      render(
        json: { integrity_ok: mismatches.empty?, tables: tables, mismatches: mismatches },
        status: mismatches.empty? ? :ok : :unprocessable_entity
      )
    rescue StandardError => e
      render(json: { integrity_ok: false, error: "#{e.class}: #{e.message}" }, status: :internal_server_error)
    end

    private

    # The reference tables whose content must be identical before/after a fault. Defaults to the taxonomy
    # live table (the highest-value reference data); override with CHAOS_INTEGRITY_TABLES (comma-separated).
    def integrity_tables
      raw = ENV["CHAOS_INTEGRITY_TABLES"].presence
      return [TaxonomyBlueGreen::LIVE_TABLE] if raw.nil?

      raw.split(",").map(&:strip).reject(&:blank?)
    end

    def store_baseline(fingerprints)
      rec = AppConfig.find_or_initialize_by(key: BASELINE_KEY)
      rec.value = fingerprints.to_json
      rec.save!
    end

    # Compare only the corruption-relevant fields: the deterministic content checksum + row_count. Both
    # sides are string-keyed (baseline is JSON-parsed; current is compute_fingerprint's string-keyed hash).
    def fingerprints_match?(expected, actual)
      expected = expected.is_a?(Hash) ? expected : {}
      actual = actual.is_a?(Hash) ? actual : {}
      expected["checksum"].to_s == actual["checksum"].to_s &&
        expected["row_count"].to_s == actual["row_count"].to_s
    end

    def require_chaos_token
      expected = ENV["CHAOS_INTEGRITY_TOKEN"].to_s
      return render(json: { integrity_ok: false, disabled: true }, status: :service_unavailable) if expected.empty?

      provided = request.headers["Authorization"].to_s.sub(/\ABearer\s+/i, "")
      return if ActiveSupport::SecurityUtils.secure_compare(provided, expected)

      render(json: { error: "unauthorized" }, status: :unauthorized)
    end
  end
end

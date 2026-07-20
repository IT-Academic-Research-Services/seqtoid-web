require "rails_helper"

# platform-overhaul #742 (epic #734) -- REST API contract.
#
# Companion to the GraphQL schema contract (spec/graphql/schema_contract_spec.rb, CZID-158). Where
# that test locks the whole GraphQL surface, this one locks a curated allowlist of the key REST
# endpoints external clients (the React app, snapshot/public links, health probes, the /graphql POST
# entrypoint itself) depend on. It does NOT snapshot the entire route table -- that churns constantly
# and would be pure noise; it pins the handful of routes whose verb/path -> controller#action mapping
# is a real contract. If one of these is renamed, removed, or its path/verb changes, the router stops
# recognizing it (or recognizes it differently) and this fails -- forcing the change to be intentional.
#
# Uses Rails.application.routes.recognize_path (the same idiom already used in
# spec/controllers/auth0_controller_spec.rb) so there is no dependency on rspec-rails routing-matcher
# type inference; it is a plain example that boots the Rails env via rails_helper.
RSpec.describe "REST API contract (key endpoints)" do
  # verb, path, expected controller, expected action.
  KEY_ENDPOINTS = [
    # The GraphQL transport entrypoint. Post-federation-collapse this POST is THE API door; the SDL
    # behind it is locked separately by spec/graphql/schema_contract_spec.rb.
    { method: :post, path: "/graphql",                              controller: "graphql",         action: "execute" },
    # Liveness/readiness probe consumed by the load balancer + k8s (health_check gem).
    { method: :get,  path: "/health_check",                         controller: "health_check/health_check", action: "index" },
    # Core visualization data endpoints the SampleView / heatmap views fetch.
    { method: :get,  path: "/visualizations/samples_taxons.json",   controller: "visualizations",  action: "samples_taxons" },
    { method: :get,  path: "/amr_heatmap/amr_counts.json",          controller: "amr_heatmap",     action: "amr_counts" },
    # Metadata lookup the upload/metadata flows depend on.
    { method: :get,  path: "/sample_types.json",                    controller: "sample_types",    action: "index" },
    # Public (shared-link) snapshot surface -- externally reachable without auth, so an especially
    # important contract not to break silently.
    { method: :get,  path: "/pub/abc123/samples/index_v2.json",     controller: "snapshot_samples", action: "index_v2" },
  ].freeze

  KEY_ENDPOINTS.each do |ep|
    it "#{ep[:method].to_s.upcase} #{ep[:path]} still routes to #{ep[:controller]}##{ep[:action]}" do
      recognized =
        begin
          Rails.application.routes.recognize_path(ep[:path], method: ep[:method])
        rescue ActionController::RoutingError => e
          raise <<~MSG
            The key REST endpoint #{ep[:method].to_s.upcase} #{ep[:path]} no longer routes anywhere
            (#{e.message}). This is part of the committed REST contract (platform-overhaul #742) that
            external clients depend on. If the removal/rename is intentional, update KEY_ENDPOINTS in
            this spec and coordinate the client change; if not, restore the route.
          MSG
        end

      expect(recognized[:controller]).to eq(ep[:controller]),
        "#{ep[:method].to_s.upcase} #{ep[:path]} now routes to controller '#{recognized[:controller]}', " \
        "expected '#{ep[:controller]}' -- breaking REST contract change (#742)."
      expect(recognized[:action]).to eq(ep[:action]),
        "#{ep[:method].to_s.upcase} #{ep[:path]} now routes to action '#{recognized[:action]}', " \
        "expected '#{ep[:action]}' -- breaking REST contract change (#742)."
    end
  end
end

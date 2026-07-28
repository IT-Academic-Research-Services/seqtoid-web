# Flag to turn elasticsearch callbacks on or off for Project/Sample/Metadatum/User models
ELASTICSEARCH_ON = !Rails.env.test?

# Initialize elasticsearch client
config = {
  host: ENV['ES_ADDRESS'],
  # Request timeout in seconds, lowered from 200 -> 60 (ENV-overridable). A slow / browned-out
  # OpenSearch domain must not pin a Puma thread for 3+ minutes: with only a handful of threads,
  # a few such requests starve the pool so even the shallow liveness probe can't get a thread and
  # k8s restarts the pod -- that thread starvation, not a failed check, is what a dependency
  # brownout escalated into a web-tier restart in the E2 chaos run (SMP-1473). 60s still covers
  # legitimate heatmap/search queries comfortably.
  transport_options: { request: { timeout: Integer(ENV.fetch('ES_REQUEST_TIMEOUT_SECONDS', '60')) } },
}
# Wrap the search client in a circuit breaker (#496) so a hung ES domain fast-fails
# the taxon/prefix search path instead of every request paying the 200s timeout.
# OpensearchCircuit.wrap is a no-op passthrough when disabled (OPENSEARCH_BREAKER_ENABLED=0).
#
# #544: skip wiring the live search client during `rails assets:precompile` (marked by the
# build-only ENV["ASSETS_PRECOMPILE"], set in the Dockerfile). Precompiling boots the full
# environment but never searches, so the OpensearchCircuit wrapper (app/lib) is not needed;
# skipping it keeps asset compilation independent of the search stack. ENV["ASSETS_PRECOMPILE"]
# is never set at runtime, so deployed behavior is unchanged.
# Wire the client AFTER the app is loaded. Referencing OpensearchCircuit (app/lib -- which
# itself depends on HttpResilience) directly in the initializer body raised
# `uninitialized constant OpensearchCircuit` at boot, because autoloaded app/lib constants are
# not available during initializer execution. That broke `db:migrate` (it boots the
# environment) and, via the PreSync migrate hook, blocked every deploy. `to_prepare` runs once
# the autoloader is ready (and re-runs on reload in development, so the wrapper never holds a
# stale class), which resolves the constant. Runtime behavior is otherwise unchanged.
Rails.application.config.to_prepare do
  unless Rails.env.test? || ENV["ASSETS_PRECOMPILE"]
    Elasticsearch::Model.client = OpensearchCircuit.wrap(Elasticsearch::Client.new(config), name: :search_opensearch)
  end
end

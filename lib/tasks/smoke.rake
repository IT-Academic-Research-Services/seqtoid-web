# Critical-path smoke gate (platform-overhaul 782).
#
# Runs as an Argo PreSync hook against the NEW image, BEFORE the Rollout is touched.
# It drives an in-process ActionDispatch integration request to each critical path --
# the real routing/middleware/controller/view stack, with the real DB/OpenSearch/secrets
# the pod would use (chamber-injected), but WITHOUT a live server or any user traffic.
#
# A non-zero exit fails the PreSync hook, which aborts the whole Argo sync: the running
# pods keep the OLD build and no user ever reaches an unvalidated build. Only when this
# passes does the Rollout update and the ping-pong cutover shift traffic 0 -> 100 onto
# pods that readiness gates already confirmed ALB-healthy.
#
# Accepted statuses default to 200/301/302: a page that renders or cleanly redirects is
# fine (an authenticated path that 302s to login is a healthy app); a 4xx/5xx or a boot
# error is a failed build. Paths + accepted statuses come from the hook's env so the gate
# is tuned in the chart values, not the code.
namespace :smoke do
  desc "Smoke the critical user paths in-process; non-zero exit on any failure (782 gate)."
  task critical_paths: :environment do
    require "action_dispatch/integration"

    paths = ENV.fetch("SMOKE_PATHS", "/health_check /").split
    accepted = ENV.fetch("SMOKE_ACCEPT_STATUSES", "200 301 302").split.map(&:to_i)

    session = ActionDispatch::Integration::Session.new(Rails.application)
    failures = []

    paths.each do |path|
      status =
        begin
          session.get(path)
          session.response.status
        rescue StandardError => e
          "ERROR(#{e.class}: #{e.message})"
        end

      ok = status.is_a?(Integer) && accepted.include?(status)
      puts "smoke: GET #{path} -> #{status} [#{ok ? 'OK' : 'FAIL'}]"
      failures << "#{path} -> #{status}" unless ok
    end

    unless failures.empty?
      abort "SMOKE GATE FAILED (#{failures.size}/#{paths.size}): #{failures.join('; ')}"
    end

    puts "SMOKE GATE PASSED: #{paths.size} critical path(s) served (accepted #{accepted.join('/')})."
  end
end

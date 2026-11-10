# Release-candidate AUPR gate tick. Scheduled on dev by the chart's rc-gate CronJob
# (deploy/charts/seqtoid-web/templates/rc-gate-cronjob.yaml). A no-op unless dev is pinned to an RC
# (DEV_PIN_KIND=rc, DEV_PIN_RC=<id>). See RcGateTickService for the flow and the result.json contract.
namespace :rc_gate do
  desc "Advance the RC AUPR gate one step and record state in the RC's result.json on S3"
  task tick: :environment do
    outcome = RcGateTickService.call
    puts "[rc_gate:tick] #{outcome}" unless outcome == :not_pinned
  end
end

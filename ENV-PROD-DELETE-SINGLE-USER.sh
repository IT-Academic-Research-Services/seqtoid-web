#!/usr/bin/env bash
# env-prod: delete ONE user and all of their data (the env-prod, single-user counterpart of
# ENV-STAGING-USERS-AND-DATA-WIPE-2026-09-02.sh). Uses the app's own deletion paths, NOT raw SQL, so
# shared data, S3 cleanup and the GDPR DeletionLog audit trail are handled the way the UI does it.
#
# DRY RUN BY DEFAULT: prints what the user owns and changes nothing.
#
#   ./ENV-PROD-DELETE-SINGLE-USER.sh --email someone@ucsf.edu            # dry run (inventory only)
#   ./ENV-PROD-DELETE-SINGLE-USER.sh --id 1234                           # dry run by user id
#   ./ENV-PROD-DELETE-SINGLE-USER.sh --email someone@ucsf.edu --delete --confirm 1234 --snapshot <SNAP_ID>
#
# Deleting requires ALL of:
#   --delete, --confirm <the user's numeric id> (must match what the lookup finds), and
#   --snapshot <id> of cluster seqtoid-env-prod with status "available". Take one first:
#     SNAP_ID=seqtoid-env-prod-before-user-delete-$(date -u +%Y%m%d-%H%M)
#     aws rds create-db-cluster-snapshot --profile idseq-prod --region us-west-2 \
#       --db-cluster-identifier seqtoid-env-prod --db-cluster-snapshot-identifier "$SNAP_ID"
#     aws rds wait db-cluster-snapshot-available --profile idseq-prod --region us-west-2 \
#       --db-cluster-snapshot-identifier "$SNAP_ID"
#
# What a --delete run does, in order (safe to re-run; each phase skips what is already gone):
#   1. Runs + samples, per workflow, via BulkDeletionService (soft delete + DeletionLog), which queues
#      the HardDeleteObjects Resque job (rows + S3 files). The script waits for those jobs to finish,
#      because HardDeleteObjects looks the user up by id -- the user row must still exist.
#   2. user.destroy! -- cascades samples that never had a run, visualizations, phylo trees, backgrounds,
#      bulk downloads (each cleans up its own S3), user settings, and project memberships.
#   3. Projects this user created that now have no samples and no members are destroyed. Projects with
#      other members or other users' samples are left alone and listed.
#   4. The Auth0 account(s) for the email in the seqtoid-prod tenant.
#
# Stops without deleting anything when:
#   - the user has export-control compliance records (attestations, clearances, device-location
#     attestations). These are restrict_with_exception in the User model pending counsel's
#     retention/erasure policy, so user.destroy! would fail. Decide the policy first.
#   - a run is still in progress (the app will not delete it); the wait times out and says so.
# NOT touched: the separate screening database (seqtoid-env-prod-screening), kept as compliance evidence.
set -euo pipefail

CTX=seqtoid-env-prod
NS=seqtoid-env-prod
SVC=seqtoid-env-prod-web
CLUSTER=seqtoid-env-prod
PROFILE=idseq-prod

EMAIL="" ; USER_ID="" ; MODE=dry ; CONFIRM="" ; SNAP_ID="" ; WAIT_MIN="${WAIT_MIN:-60}"
while [ $# -gt 0 ]; do
  case "$1" in
    --email)    EMAIL="$2"; shift 2 ;;
    --id)       USER_ID="$2"; shift 2 ;;
    --delete)   MODE=delete; shift ;;
    --confirm)  CONFIRM="$2"; shift 2 ;;
    --snapshot) SNAP_ID="$2"; shift 2 ;;
    --wait-min) WAIT_MIN="$2"; shift 2 ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done
[ -n "$EMAIL" ] || [ -n "$USER_ID" ] || { echo "give --email or --id"; exit 2; }

if [ "$MODE" = delete ]; then
  [ -n "$CONFIRM" ] || { echo "Refusing: --delete needs --confirm <user id>"; exit 1; }
  [ -n "$SNAP_ID" ] || { echo "Refusing: --delete needs --snapshot <cluster snapshot id>"; exit 1; }
  read -r SNAP_STATUS SNAP_CLUSTER < <(aws rds describe-db-cluster-snapshots --profile "$PROFILE" --region us-west-2 \
    --db-cluster-snapshot-identifier "$SNAP_ID" \
    --query 'DBClusterSnapshots[0].[Status,DBClusterIdentifier]' --output text)
  [ "$SNAP_STATUS" = available ] || { echo "Refusing: snapshot $SNAP_ID is '$SNAP_STATUS', not available"; exit 1; }
  [ "$SNAP_CLUSTER" = "$CLUSTER" ] || { echo "Refusing: snapshot $SNAP_ID is of '$SNAP_CLUSTER', not $CLUSTER"; exit 1; }
  echo "snapshot $SNAP_ID of $CLUSTER is available"
fi

# The main Resque pod (the same pod the 2026-09-25 single-user delete ran in).
POD=$(kubectl --context "$CTX" -n "$NS" get pods -o name | grep 'seqtoid-web-resque-[0-9a-f]*-[a-z0-9]*$' | head -1 | cut -d/ -f2)
[ -n "$POD" ] || { echo "no resque pod found"; exit 1; }
echo "pod: $POD   mode: $MODE"

RB=/tmp/delete_single_user_$$.rb
kubectl --context "$CTX" -n "$NS" exec -i "$POD" -c resque -- sh -c "cat > $RB" <<'RUBY'
email   = ENV["DEL_EMAIL"].to_s.strip.presence
want_id = ENV["DEL_USER_ID"].to_s.strip.presence
mode    = ENV["DEL_MODE"] == "delete" ? :delete : :dry
confirm = ENV["DEL_CONFIRM_ID"].to_s.strip
wait_s  = ENV["DEL_WAIT_MIN"].to_i * 60

u = email ? User.find_by(email: email) : User.find_by(id: want_id)
abort("DEL ABORT: no user for #{email || want_id}") unless u
abort("DEL ABORT: --email and --id point at different users (#{u.id} vs #{want_id})") if want_id && u.id != want_id.to_i
email ||= u.email

def inventory(u)
  runs_by_tech = PipelineRun.joins(:sample).where(samples: { user_id: u.id }).group(:technology).count
  wrs_by_wf = WorkflowRun.where(user_id: u.id).group(:workflow).count
  compliance = {
    export_control_attestations: ExportControlAttestation.where(user_id: u.id).count,
    export_control_clearances: ExportControlClearance.where(user_id: u.id).count,
    device_location_attestations: DeviceLocationAttestation.where(user_id: u.id).count,
  }
  created = Project.where(creator_id: u.id)
  {
    samples: Sample.where(user_id: u.id).count,
    samples_soft_deleted: Sample.where(user_id: u.id).where.not(deleted_at: nil).count,
    pipeline_runs_by_technology: runs_by_tech,
    workflow_runs_by_workflow: wrs_by_wf,
    visualizations: u.visualizations.count,
    phylo_trees: u.phylo_trees.count,
    phylo_tree_ngs: u.phylo_tree_ngs.count,
    backgrounds: u.backgrounds.count,
    bulk_downloads: u.bulk_downloads.count,
    project_memberships: u.projects.count,
    projects_created: created.count,
    # Sample.where(project_id:) not p.samples: Project#samples returns nil on this codebase.
    projects_created_shared: created.select { |p| p.users.where.not(id: u.id).exists? || Sample.where(project_id: p.id).where.not(user_id: u.id).exists? }.map(&:id),
    compliance: compliance,
  }
end

auth0_ids = Auth0UserManagementHelper.get_auth0_user_ids_by_email(email) rescue ["(auth0 lookup failed: #{$!.class})"]
puts "DEL user: id=#{u.id} email=#{u.email} role=#{u.role.inspect} created=#{u.created_at}"
puts "DEL auth0: #{auth0_ids.inspect}"
inv = inventory(u)
inv.each { |k, v| puts "DEL owns #{k}: #{v.inspect}" }

if mode == :dry
  puts "DEL DRY RUN: nothing changed. To delete: --delete --confirm #{u.id} --snapshot <id>"
  exit 0
end

abort("DEL ABORT: --confirm #{confirm.inspect} does not match user id #{u.id}") unless confirm == u.id.to_s
held = inv[:compliance].select { |_, n| n.positive? }
if held.any?
  abort("DEL ABORT: export-control compliance records exist (#{held.inspect}). They are restrict_with_exception " \
        "pending counsel's retention/erasure policy, so the user cannot be destroyed. Nothing was deleted.")
end

# 1. Runs + samples through the app's deletion pipeline (soft delete + DeletionLog + HardDeleteObjects).
WorkflowRun::MNGS_WORKFLOWS.each do |wf|
  tech = WorkflowRun::MNGS_WORKFLOW_TO_TECHNOLOGY[wf]
  sids = PipelineRun.joins(:sample).where(samples: { user_id: u.id }, technology: tech, deleted_at: nil).distinct.pluck(:sample_id)
  next if sids.empty?
  r = BulkDeletionService.call(object_ids: sids, user: u, workflow: wf)
  puts "DEL phase1 #{wf}: samples=#{sids.size} deleted_runs=#{r[:deleted_run_ids].size} deleted_samples=#{r[:deleted_sample_ids].size} error=#{r[:error].inspect}"
end
WorkflowRun.where(user_id: u.id, deleted_at: nil).where.not(workflow: WorkflowRun::MNGS_WORKFLOWS).group_by(&:workflow).each do |wf, runs|
  r = BulkDeletionService.call(object_ids: runs.map(&:id), user: u, workflow: wf)
  puts "DEL phase1 #{wf}: runs=#{runs.size} deleted_runs=#{r[:deleted_run_ids].size} deleted_samples=#{r[:deleted_sample_ids].size} error=#{r[:error].inspect}"
end

# Wait for the queued HardDeleteObjects jobs (the user row must exist while they run).
pending = lambda do
  PipelineRun.joins(:sample).where(samples: { user_id: u.id }).count +
    WorkflowRun.where(user_id: u.id).count +
    Sample.where(user_id: u.id).where.not(deleted_at: nil).count
end
deadline = Time.now + wait_s
while (left = pending.call).positive?
  if Time.now > deadline
    abort("DEL STOP: #{left} runs/soft-deleted samples still pending after #{wait_s / 60} min. In-progress runs are " \
          "not deletable until they finish; hard deletes may still be draining (check the hard_delete_objects " \
          "queue / Resque failures). The user row is kept so the jobs can finish. Re-run this script to continue.")
  end
  puts "DEL waiting: #{left} runs/soft-deleted samples still being hard-deleted..."
  sleep 30
end
puts "DEL phase1 done: no runs or soft-deleted samples left"

# 2. The user row and everything that cascades from it.
created_ids = Project.where(creator_id: u.id).pluck(:id)
u.destroy!
puts "DEL phase2: user #{u.id} destroyed"

# 3. Projects this user created that are now empty and memberless.
Project.where(id: created_ids).find_each do |p|
  if Sample.where(project_id: p.id).exists? || p.users.exists?
    puts "DEL phase3 kept project #{p.id} (#{p.name}): has other members or samples"
  else
    p.destroy!
    puts "DEL phase3 destroyed empty project #{p.id} (#{p.name})"
  end
end

# 4. Auth0.
Auth0UserManagementHelper.delete_auth0_user(email: email)
puts "DEL phase4 auth0 after: #{Auth0UserManagementHelper.get_auth0_user_ids_by_email(email).inspect}"
puts "DEL done: user=#{User.find_by(id: u.id).inspect} samples_left=#{Sample.where(user_id: u.id).count}"
RUBY

kubectl --context "$CTX" -n "$NS" exec "$POD" -c resque -- \
  env DEL_EMAIL="$EMAIL" DEL_USER_ID="$USER_ID" DEL_MODE="$MODE" DEL_CONFIRM_ID="$CONFIRM" DEL_WAIT_MIN="$WAIT_MIN" \
  sh -c "cd /app && chamber exec $SVC -- bundle exec rails runner $RB; rc=\$?; rm -f $RB; exit \$rc" 2>&1 \
  | grep -E '^DEL |Error|error' | grep -v OpenTelemetry

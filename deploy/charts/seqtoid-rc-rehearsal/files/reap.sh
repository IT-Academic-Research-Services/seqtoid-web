#!/usr/bin/env bash
# Reaper for rehearsal clones (seqtoid-rc-rehearsal chart). Deletes every Aurora cluster whose id starts
# with "$CLONE_PREFIX-", carries the tag seqtoid-rc-rehearsal=true and is older than $MAX_AGE_HOURS.
# Runs whatever the dev pin, so a rehearsal killed after its RC left vetting cannot leak a billed
# instance. The IAM role can only delete clusters/instances under the prefix, so this cannot touch the
# live cluster even if the filter below were wrong.
set -euo pipefail
: "${CLONE_PREFIX:?}" "${MAX_AGE_HOURS:?}"
case "$CLONE_PREFIX" in *rc-rehearsal*) ;; *) echo "refusing: CLONE_PREFIX must contain rc-rehearsal"; exit 1 ;; esac
now="$(date +%s)"
aws rds describe-db-clusters \
  --query "DBClusters[?starts_with(DBClusterIdentifier, '${CLONE_PREFIX}-')].[DBClusterIdentifier, ClusterCreateTime, join(',', TagList[?Key=='seqtoid-rc-rehearsal'].Value)]" \
  --output text | while read -r id created tag; do
  [ -n "${id:-}" ] || continue
  if [ "${tag:-}" != "true" ]; then echo "${id}: not tagged seqtoid-rc-rehearsal=true; leaving it"; continue; fi
  age_h=$(( (now - $(date -d "$created" +%s)) / 3600 ))
  if [ "$age_h" -lt "$MAX_AGE_HOURS" ]; then echo "${id}: ${age_h}h old; keeping"; continue; fi
  echo "${id}: ${age_h}h old; deleting"
  for inst in $(aws rds describe-db-clusters --db-cluster-identifier "$id" --query 'DBClusters[0].DBClusterMembers[].DBInstanceIdentifier' --output text); do
    aws rds delete-db-instance --db-instance-identifier "$inst" --skip-final-snapshot >/dev/null 2>&1 || true
    aws rds wait db-instance-deleted --db-instance-identifier "$inst" || true
  done
  aws rds delete-db-cluster --db-cluster-identifier "$id" --skip-final-snapshot >/dev/null \
    || echo "WARNING: could not delete ${id}; the next run retries"
done

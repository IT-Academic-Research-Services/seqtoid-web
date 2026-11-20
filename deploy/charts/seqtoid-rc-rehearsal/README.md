# seqtoid-rc-rehearsal

The in-cluster half of the RC battery's `migration_rehearsal` check (forgejo 1267). Off by default.

While dev is pinned to a release candidate, a CronJob in env-staging:

1. fast-clones (copy-on-write) the env-staging Aurora cluster to `<clonePrefix>-<rc>-a<attempt>`;
2. proves the clone is the target (endpoint name and `@@aurora_server_id`), never the live cluster;
3. runs `scripts/rc-battery/migration-rehearsal.sh` from the RC image against the clone;
4. deletes the clone and writes `s3://<results.bucket>/<results.prefix>/<rc>/result.json`.

The battery (`.github/workflows/rc-battery.yml`, job `migration_rehearsal`) waits for that file.

## Where the RC comes from

The Argo app layers cypherid-web-infra `deploy/argocd/values/seqtoid-web/dev-pin.yaml` after this
environment's values. That file is written only by seqtoid-gitops `bin/release`: `cut-rc` sets
`pin.kind: rc` with the RC's `image.tag` + `image.digest`, and staging or rejecting the RC sets it back
to `kind: none`. The rehearsal CronJob renders only while `pin.kind` is `rc`; a lease renders nothing.

## What keeps the rehearsal away from live staging

- **Identity.** The orchestrator holds the IRSA role (seqtoid-ssot-infra app stack `rc_rehearsal.tf`):
  restore/create/delete only under `clonePrefix`, an explicit deny on everything else against the live
  cluster, read of `DB_USERNAME`/`DB_PASSWORD` only, write to the results prefix only.
- **The Rails child has no AWS identity.** It gets an allow-listed env: `OFFLINE=1` (every app SDK
  client stubbed with fake keys), no `AWS_*` web-identity variables, no chamber, no `ES_ADDRESS`. A data
  migration that reaches for S3/SQS/SFN/OpenSearch fails the rehearsal instead of writing.
- **Redis** is an in-pod sidecar bound to 127.0.0.1, so boot and any Resque enqueue land there.
- **Network.** The NetworkPolicy allows DNS, 3306 inside the VPC and 443 out; not 6379, not IMDS.
- **Target proof.** The host the child connects to is the endpoint of the cluster the run just created,
  checked by name and again from inside MySQL before the script runs.

## Leftovers

The run deletes its clone in an `ensure`; the next tick reaps any tagged clone a killed run left; the
reaper CronJob deletes tagged clones older than `reaper.maxAgeHours` whatever the pin.

## Cost

One `db.r6g.large` instance for roughly 30-60 minutes per RC (about $0.15-0.30), plus copy-on-write
storage for pages the migrations change.

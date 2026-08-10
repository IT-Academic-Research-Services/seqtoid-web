# seqtoid-web Helm chart

Runs **seqtoid-web on EKS** via **Argo CD + Argo Rollouts**, replacing the ECS/czecs
task-definition path. This is the crux artifact of the ECS→EKS blue/green cutover
(EKS-BLUEGREEN-CUTOVER-PLAN-2026-06-27.md; epic #319).

## What it renders

| Template | Replaces (ECS) | Notes |
|---|---|---|
| `rollout.yaml` | `czecs.json` (web service) | `kind: Rollout`, **blueGreen** strategy, active/preview Services |
| `services.yaml` | ALB target group | `<fullname>-active` (live) + `<fullname>-preview` (new color) |
| `workers.yaml` | `czecs-resque.json` ×4 + `czecs-shoryuken.json` | resque / scheduler / pipeline-monitor / result-monitor + shoryuken Deployments |
| `migrate-job.yaml` | `czecs-task-migrate.json` (run-task) | `rails db:migrate:with_data` (+ `seed:migrate`, see `migrate.seedMigrate`) as an Argo CD **PreSync hook** |
| `analysistemplate.yaml` | (new) | smoke Job — curls the preview color's `/health_check`; gates promotion |
| `ingress.yaml` | external ALB | AWS Load Balancer Controller → the **active** Service |
| `serviceaccount.yaml` | ECS web task role | **IRSA** (`eks.amazonaws.com/role-arn`) |
| `hpa.yaml` | ECS service autoscaling | targets the Rollout (prod only) |

## Delivery model

- The **chart** lives here (versions with the code). **Env values** live in
  `cypherid-web-infra/deploy/argocd/values/seqtoid-web/<env>.yaml` and are layered on
  via the Argo CD multi-source Application.
- **dev/staging**: `blueGreen.autoPromotionEnabled: true` — promote automatically once
  the smoke AnalysisRun passes. **prod**: `false` — the rollout pauses after smoke for a
  manual `kubectl argo rollouts promote`.
- **Secrets**: least-change path — the image ENTRYPOINT (`bin/entrypoint.sh`) runs
  `chamber exec idseq-<env>-web`, so the pod only needs the IRSA role with SSM read.
  (External Secrets Operator is a later swap — #325.)
- **DB**: MySQL 8 via **RDS reached from the pods** (the committed direction); no
  in-cluster DB. `deploy/postgres/` is the separate appliance adapter.
- **Logs**: `RAILS_LOG_TO_STDOUT=yes` → stdout (K8s-native); no `awslogs`.

## Deploy resilience & abort → rollback (#467a / #494)

The blueGreen rollout is **health-gated**, so a bad build cannot take live traffic:

- **prePromotionAnalysis → `<fullname>-smoke`** runs the smoke Job against the
  **preview** color *before* any traffic shift. A failing smoke **aborts** the rollout;
  the **active (previous)** color keeps serving and the bad preview is scaled down after
  `blueGreen.abortScaleDownDelaySeconds`. This holds even with `autoPromotionEnabled: true`
  (dev/staging) — auto-promotion only fires once the analysis **passes**.
- **postPromotionAnalysis** (opt-in per env via `blueGreen.analysis.postPromotion: true`,
  intended for prod) re-runs smoke *after* promotion; a regression there **auto-aborts and
  rolls back** to the prior ReplicaSet.
- **Web pod**: readiness + liveness on `/health_check`; preStop drain
  (`gracefulDrain.preStopSleepSeconds`) + `gracefulDrain.terminationGracePeriodSeconds`.
- **Workers**: exec **liveness** probe (`workerLivenessProbe`, pgreps the worker's command
  word) so a hung/crashed supervisor is restarted; **drain** via a longer, worker-specific
  `workerDrain.terminationGracePeriodSeconds` (default 120s vs web's 60s) so an in-flight
  job finishes on SIGTERM before SIGKILL — override per worker with
  `workers.<name>.terminationGracePeriodSeconds` for long-running units of work.

### Runbook — a rollout aborted (smoke failed)

```sh
ROLLOUT=czid-<env>-seqtoid-web        # e.g. czid-prod-seqtoid-web
NS=czid-<env>

kubectl argo rollouts get rollout "$ROLLOUT" -n "$NS"   # status shows "Degraded/Aborted"
kubectl argo rollouts status  "$ROLLOUT" -n "$NS"
```

- The **active color is unchanged** — the app is still serving the last-good build; there
  is no user-facing outage to firefight. Diagnose before acting.
- Inspect the smoke AnalysisRun and its Job logs to see which path/status failed:
  ```sh
  kubectl get analysisrun -n "$NS" -l rollout=$ROLLOUT
  kubectl logs -n "$NS" job/<smoke-job-name>
  ```
- **Fix forward** (preferred): push a corrected image; Argo syncs a new preview and the
  smoke gate re-runs. Do **not** promote a failed preview.
- **Retry** the same build after a transient failure:
  `kubectl argo rollouts retry rollout "$ROLLOUT" -n "$NS"`.
- **Post-promotion regression** (prod, `postPromotion: true`): the rollout auto-aborts and
  the prior ReplicaSet is restored. Confirm with `kubectl argo rollouts get rollout`; if a
  manual undo is needed use `kubectl argo rollouts undo "$ROLLOUT" -n "$NS"`.

> Follow-up (#326): the smoke gate is a curl Job today; a Prometheus-backed error-rate /
> latency metric will additionally abort a build that is *up but erroring*.

## Local validation

```sh
helm lint deploy/charts/seqtoid-web
for env in dev staging prod; do
  helm template svc deploy/charts/seqtoid-web \
    -f ../cypherid-web-infra/deploy/argocd/values/seqtoid-web/$env.yaml \
    | kubeconform -strict -ignore-missing-schemas -kubernetes-version 1.30.0 -summary
done
```

The CI gate (cypherid-web-infra `argocd-ci.yml`, #327) additionally validates the
Argo `Rollout` / `AnalysisTemplate` CRDs against the schema catalog.

## Not yet wired (blocked on AWS applies — Phase 0/2)

Image account/DNS/cert/subnet values still carry `REPLACE_*` placeholders (filled with
the real applied infra), and the control-plane bootstrap (LBC IRSA, Argo CD install,
`root-app`) is #321. The GitOps image-tag advance that triggers a deploy is #444.

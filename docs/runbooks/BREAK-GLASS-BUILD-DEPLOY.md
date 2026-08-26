# BREAK-GLASS: build + deploy seqtoid-web WITHOUT GitHub Actions

**Use this ONLY when GitHub Actions is down** (org-wide outage) and an image still has to
ship. This is the manual, out-of-band equivalent of the normal CD pipeline. It is **not**
the routine path -- when Actions is healthy, merge to `main` and let the workflows do this.

The tool: [`tools/break-glass/build-and-promote.sh`](../../tools/break-glass/build-and-promote.sh).

> Golden rule: this path bypasses the CI gates that normally protect a deploy. **You** are
> now those gates. Run the tests, keep Trivy clean, keep the image cosign-signed, and get a
> human approval for staging/prod. The CHECKLIST at the bottom captures exactly what CI would
> have enforced.

---

## What the normal (Actions) path does -- and what this replaces

| Normal CD (GitHub Actions) | Break-glass equivalent |
|---|---|
| `build-docker-image.yml`: buildx amd64 -> dev ECR `sha-<commit8>`, Trivy scan, cosign sign | `build-and-promote.sh build` |
| `gitops-advance-dev.yml`: write `image.tag`/`digest` into `cypherid-web-infra` `dev.yaml`, Argo deploys dev | `build-and-promote.sh advance-dev` |
| `promote-image.yml` + `promote-to-env.yml`: skopeo copy dev->env ECR, pin `<env>.yaml` digest+tag | `build-and-promote.sh promote --to staging\|prod` |
| **Argo CD** syncs from the git pin and runs the blue/green rollout | **unchanged** -- Argo is independent of Actions and still does the deploy |

The script reuses the repo's own `bin/build-docker` and runs the identical Trivy + cosign
gates, so a break-glass image is byte-identical to a CI image.

---

## Delivery topology (verified against the Argo `Application` manifests)

| env | values file (in `cypherid-web-infra`) | Argo tracks cwi branch | AWS account | AWS profile |
|---|---|---|---|---|
| dev | `deploy/argocd/values/seqtoid-web/dev.yaml` | `main` | 491013321714 | `idseq-dev` |
| staging (env-staging) | `.../staging.yaml` | `integration` | 030998640247 | `idseq-staging` |
| prod (env-prod) | `.../env-prod.yaml` | `main` **(branch-protected)** | 283694049553 | `idseq-prod` |

Region is **us-west-2** everywhere. ECR repo name is **`seqtoid-web`** in every account.

**Two things that bite people:**

1. **The chart pins by DIGEST, not tag.** `deploy/charts/seqtoid-web/templates/_helpers.tpl`
   renders `repository@digest` whenever `image.digest` is set and *ignores* `image.tag`. A
   tag-only bump is a silent no-op. The script always writes **both** digest and tag.
2. **"prod" = `env-prod.yaml`** (the seqtoid overhaul prod, account 283694049553), **not**
   the legacy CZI `prod.yaml` (`czid-prod` namespace). Do not touch `prod.yaml`.

---

## Prerequisites (one-time laptop setup)

Install:

```sh
# macOS (Homebrew)
brew install docker skopeo cosign trivy awscli yq gh
# docker buildx ships with Docker Desktop; verify:
docker buildx version
```

- **docker + buildx** -- `bin/build-docker` uses a `docker-container` buildx builder for the
  registry cache. Build **amd64** (the cluster nodes are x86); on Apple Silicon buildx does
  this natively via the `linux/amd64` platform (see the local-build recipe -- BuildKit is
  required, the legacy builder cannot cross-build amd64 here).
- **skopeo** -- cross-account ECR copy, digest-preserving (`copy --all`).
- **cosign** -- keyless signing (Sigstore/Fulcio). First use opens a **browser device flow**
  to authenticate your identity; be ready to complete it. Ambient OIDC is not available off-CI.
- **trivy** -- image vulnerability scan (same policy as CI).
- **aws CLI v2** with three profiles configured for us-west-2: `idseq-dev`, `idseq-staging`,
  `idseq-prod`. If they use SSO: `aws sso login --profile idseq-<env>` before you start. The
  CI OIDC promote role is **not** assumable from a laptop -- the script uses your own profiles.
- **yq (v4)**, **gh** (authenticated: `gh auth status`), **git**.
- **A local checkout of `cypherid-web-infra`** (the GitOps values repo). Pass its path with
  `--infra-dir`, or export `INFRA_DIR=/path/to/cypherid-web-infra`.
- **kubectl** with contexts for each EKS cluster (only needed to hard-refresh Argo / drive the
  blue/green promotion -- see below):
  ```sh
  aws eks update-kubeconfig --name seqtoid-dev      --region us-west-2 --profile idseq-dev
  aws eks update-kubeconfig --name seqtoid-staging  --region us-west-2 --profile idseq-staging
  aws eks update-kubeconfig --name seqtoid-env-prod --region us-west-2 --profile idseq-prod
  ```
- **ECR permissions**: your dev profile needs push to dev `seqtoid-web`
  (`ecr:PutImage`/`Batch*`/`Upload*`, `GetAuthorizationToken`); staging/prod profiles need
  push to their `seqtoid-web` repo; all need `ecr:DescribeImages`/`BatchGetImage` for the
  digest verification. (These are the same actions the CI build/promote roles hold.)

---

## The exact command sequence: ship dev -> staging -> prod

Run everything from the **seqtoid-web repo root**, on the **commit you want to ship**, with a
**clean working tree** (the image is tagged `sha-<commit8>`, which must match the tree).

Set once:

```sh
export INFRA_DIR=/path/to/cypherid-web-infra     # your local cypherid-web-infra checkout
BG=./tools/break-glass/build-and-promote.sh
```

### 0. Preview first (always)

Every subcommand takes `--dry-run`. Dry-run prints the exact build/copy/commit/PR it would
run and changes nothing. Do this before each real step.

```sh
$BG build --dry-run
```

### 1. Build + scan + sign (pushes to DEV ECR)

```sh
$BG build
# -> builds amd64 via bin/build-docker, pushes 491013321714.../seqtoid-web:sha-<commit8>,
#    runs Trivy (HIGH,CRITICAL, ignore-unfixed, .trivyignore baseline) -- HARD gate,
#    runs cosign sign --recursive (keyless; complete the browser prompt),
#    prints the tag (sha-<commit8>) and the immutable digest.
```

Note the printed `sha-<commit8>` -- call it `$TAG` below.

### 2. Deploy to dev

```sh
$BG advance-dev --source $TAG --infra-dir "$INFRA_DIR"
# -> pins dev.yaml (digest+tag) on a branch off cwi main, opens a PR (base: main).
#    Add --merge to squash-merge it immediately (dev is low-risk; this mirrors the
#    normal auto-advance). Argo CD (dev autoPromotionEnabled=true) then syncs +
#    blue/green-promotes on smoke pass.
```

Confirm the rollout (see "Force an Argo hard-refresh + confirm rollout" below), and smoke dev.

### 3. Promote to staging (get a human approval first)

```sh
$BG promote --to staging --source $TAG --infra-dir "$INFRA_DIR"
# -> skopeo copies dev-ECR@digest -> staging-ECR (030998640247), verifies the digest,
#    pins staging.yaml (digest+tag) on a branch off cwi INTEGRATION, opens a PR
#    (base: integration). Add --merge to merge it. Argo (staging autoPromotionEnabled=true)
#    syncs + promotes on smoke pass.
```

### 4. Promote to prod (env-prod) -- gated, no auto-merge, manual rollout promote

```sh
$BG promote --to prod --source $TAG --infra-dir "$INFRA_DIR"
# -> skopeo copies dev-ECR@digest -> prod-ECR (283694049553), verifies the digest,
#    pins env-prod.yaml (digest+tag) on a branch off cwi MAIN, opens a PR (base: main).
```

**cwi `main` is branch-protected**, so:
- `--merge` is **refused** for prod. A human must approve + merge the PR.
- After merge, Argo syncs, but env-prod has `blueGreen.autoPromotionEnabled: false` -- the
  rollout stands up the **preview** color and **pauses**. It does not take live traffic until
  you promote it manually (next section).

---

## Force an Argo hard-refresh + confirm the rollout

Argo polls git, but to pick up a just-merged pin immediately, hard-refresh:

```sh
# via argocd CLI (if you have it + are logged in)
argocd app get seqtoid-web-<env> --hard-refresh
argocd app sync seqtoid-web-<env>

# or via kubectl annotation on the Argo Application (no argocd login needed)
kubectl -n argocd annotate application seqtoid-web-<env> \
  argocd.argoproj.io/refresh=hard --overwrite
```

`<env>` is the Argo app name: `seqtoid-web-dev`, `seqtoid-web-staging`, `seqtoid-web-env-prod`.

Confirm the image actually rolled (digest in the running pods matches the pin):

```sh
# find the rollout + namespace
kubectl argo rollouts list rollout -A | grep seqtoid-web
ROLLOUT=czid-<env>-seqtoid-web      # e.g. czid-dev-seqtoid-web ; env-prod uses namespace seqtoid-env-prod
NS=<namespace>                      # dev: seqtoid-dev  staging: seqtoid-staging  prod: seqtoid-env-prod

kubectl argo rollouts get rollout "$ROLLOUT" -n "$NS"     # watch blue/green status
kubectl argo rollouts status  "$ROLLOUT" -n "$NS"
kubectl -n "$NS" get pods -l app.kubernetes.io/name=seqtoid-web \
  -o jsonpath='{range .items[*]}{.spec.containers[0].image}{"\n"}{end}' | sort -u
```

### Blue/green cutover note (staging manual case / prod)

dev + staging have `blueGreen.autoPromotionEnabled: true` -- once the smoke `AnalysisRun`
passes, the rollout promotes automatically. **env-prod has it `false`** -- the rollout pauses
after smoke and waits for a manual promote:

```sh
# after verifying the preview color is healthy:
kubectl argo rollouts promote "$ROLLOUT" -n "$NS"

# if you must flip the setting itself (e.g. a stuck staging), patch the Rollout:
kubectl -n "$NS" patch rollout "$ROLLOUT" --type merge \
  -p '{"spec":{"strategy":{"blueGreen":{"autoPromotionEnabled":true}}}}'
```

> Prefer `kubectl argo rollouts promote` over patching `autoPromotionEnabled` -- promote is a
> one-shot deliberate cutover; patching changes the env's standing behavior (and Argo self-heal
> may revert it against the chart value). Only patch to recover a wedged rollout, and revert it.

A rollout that **aborts** (smoke failed) leaves the previous color serving -- no user-facing
outage. Diagnose before acting; see `deploy/charts/seqtoid-web/README.md` ("a rollout aborted").

---

## CHECKLIST -- the CI gates you are now responsible for

Break-glass bypasses PR CI. Before you merge each pin, confirm:

- [ ] **Tests pass locally.** Run the suite you would have relied on CI for:
      `make ci-local` (RSpec + jest). A red suite is a red deploy -- do not ship it.
- [ ] **Build is clean + from the right commit.** Working tree clean; `git rev-parse HEAD`
      is the commit you intend; the printed tag is `sha-<that commit's first 8>`.
- [ ] **Trivy is clean.** `build` runs the HIGH/CRITICAL scan as a HARD gate. If it fails,
      forward-fix the dependency or baseline the CVE in `.trivyignore` (with a justification
      + forward-fix note) and rebuild. Do **not** wave it through with `--trivy-advisory`
      unless you understand and accept the specific finding (that flag restores the CD-path
      advisory behavior from SMP-1638 and should be rare).
- [ ] **Image is cosign-signed.** `build` runs `cosign sign --recursive`; complete the
      browser device-flow prompt. Signed images are what the deploy side can enforce.
- [ ] **Digest verified across accounts.** For staging/prod, `promote` re-reads the target
      ECR and refuses to pin unless the copied digest matches the source. (Automatic -- just
      don't ignore a "DIGEST MISMATCH" error.)
- [ ] **Human approval for staging/prod.** Get a second person to approve the promotion PR.
      For prod, that approval + merge is mandatory (protected branch); the rollout then
      requires a manual `kubectl argo rollouts promote`.
- [ ] **You confirmed the rollout.** Pods are running the new digest; `/health_check` is green;
      you smoked the app.
- [ ] **Announce it.** This was an out-of-band deploy -- tell the team what shipped where, and
      why the normal path was unavailable.

---

## When Actions comes back

Re-run the normal pipeline for the same commit so the automated provenance (Sentry release,
promotion records, GHCR source-of-record publish) catches up, and so `main`/`integration`
reflect the pins you made by hand. The break-glass pins are already correct; this just
re-establishes the automated record.

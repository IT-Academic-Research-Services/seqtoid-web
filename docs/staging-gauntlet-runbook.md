# Staging promotion gauntlet — activation runbook

The seqtoid staging promotion gauntlet vets a promotable dev image against an isolated,
staging-shaped candidate env before it is allowed to reach **env-staging**
(`env-staging.seqtoid.org`). Everything is merged but **inert** until the steps below are done.
This runbook is the ordered, safe procedure to turn it on.

> **The two staging envs.** `env-staging.seqtoid.org` is the real staging env this gate protects.
> `staging.seqtoid.org` is Jay's legacy env — the gauntlet refuses to ever target it. Do not conflate.

## What's already in place

**seqtoid-web**
- `.github/workflows/staging-gauntlet.yml` — orchestrator (`workflow_dispatch`: `sha`, `confirm_target`).
- `bin/gauntlet_env` — provisions/reaps the candidate env (git-directory ApplicationSet element).
- `.github/workflows/gauntlet-ttl-reaper.yml` — hourly backstop that reaps orphaned candidates.
- `e2e/setup/gauntlet.config.ts` + `e2e-automation.yml` `base-url` — E2E suite pointed at the candidate.
- Reusable tiers: `data-integrity.yml`, `contract-api.yml`, `pipeline-aupr.yml`.

**cypherid-web-infra**
- `deploy/argocd/apps/dev/seqtoid-gauntlet-candidate-appset.yaml` + `values/seqtoid-web/gauntlet-candidate.yaml`.
- `deploy/argocd/gauntlet-candidates/` — element dir (empty until a run writes one).
- `.github/workflows/gitops-promote.yml` — dev→staging: reviewer gate → verify `gauntlet-passed`
  attestation → `cosign copy` the vetted image+attestation into the staging registry → pin the sha.
- `deploy/argocd/policies/gauntlet-clusterimagepolicy.yaml` — env-staging admission policy (`mode: warn`).
- `argocd-ci.yml` immutability guard — env-staging must run an immutable `sha-*` tag (`latest` warns only).

## Step 1 — Configuration (no effect on any env yet)

### seqtoid-web → Settings → Secrets and variables → Actions

| Kind | Name | Value / note |
| --- | --- | --- |
| var | `STAGING_GAUNTLET_ENABLED` | `true` — master switch; gates the gauntlet **and** the TTL reaper. Leave unset to keep everything off. |
| var | `GAUNTLET_PROVISION_ROLE` | dev IAM role for provision/teardown (defaults to `czid-dev-gh-actions-preview-build`). |
| var | `GAUNTLET_ATTEST_ROLE` | dev IAM role for the attest job (ECR describe + `cosign attest`). Default same as above. |
| var | `GAUNTLET_CANDIDATE_TTL_HOURS` | optional; reaper TTL, default `24`. |
| secret | `GITOPS_TOKEN` | token that can push element files to `cypherid-web-infra` (used by `gauntlet_env` + reaper). |
| secret | `CZID_USERNAME` / `CZID_PASSWORD` (+ `_WITH_FF`) | E2E auth — already set for the existing E2E suite. |

Optional AUPR tier (expensive, cross-repo) — leave off unless you want it gating:
- var `NIGHTLY_PIPELINE_E2E_ENABLED` = `true`
- secret `WORKFLOWS_DISPATCH_TOKEN` — actions:write + read on `seqtoid-workflows`
- set `SHORT_READ_MNGS_MIN_AUPR=0.98` on `seqtoid-workflows` so its AUPR gate bites

### cypherid-web-infra → Settings → Secrets and variables → Actions

| Kind | Name | Value / note |
| --- | --- | --- |
| var | `GAUNTLET_VERIFY_ROLE` | dev-account role with ECR **read** on `seqtoid-web` (for `cosign verify-attestation`). |
| var | `STAGING_ECR_WRITE_ROLE` | staging-account (`030998640247`) role with ECR **write** on `seqtoid-web` (for `cosign copy`). Cross-account trust from the dev promote workflow (role chaining). |
| var | `GAUNTLET_WORKFLOW_REGEXP` | cert-identity regexp matching `.../seqtoid-web/.github/workflows/staging-gauntlet.yml@...` (the attestation signer). |
| env | `promote-staging` (Settings → Environments) | add **required reviewers** — the human approval gate on dev→staging. |

### AWS / IAM (dev 491013321714, staging 030998640247)

- Dev roles above: GitHub OIDC trust + the ECR permissions listed; the provision/teardown role also
  needs EKS access to the dev cluster (`czid-dev-eks-v2`) for `gauntlet_env`'s Healthy/Synced wait.
- `STAGING_ECR_WRITE_ROLE`: cross-account trust from the dev promote job + ECR write to the
  staging-account `seqtoid-web` repo.

## Step 2 — Admission policy in the staging cluster (audit-first)

The policy ships `mode: warn` (audit, non-blocking). Bring it up in the staging cluster **before**
any enforcement:

1. Ensure the sigstore **policy-controller** runs in the staging cluster (`czid-staging-eks`) and
   extend the sigstore Argo app so `gauntlet-clusterimagepolicy.yaml` is synced there.
2. Opt the env-staging namespace in:
   ```bash
   kubectl label ns <env-staging-namespace> policy.sigstore.dev/include=true
   ```
   Do **not** label system namespaces — under `enforce` their unsigned images would be denied.
3. Confirm the controller logs show the policy loaded and only **warning** (not denying).

## Step 3 — Enable + dry-run the gauntlet

1. Set `STAGING_GAUNTLET_ENABLED=true` (seqtoid-web). This also arms the hourly TTL reaper.
2. Dispatch a dry run on a known-good dev image:
   - Actions → **Staging promotion gauntlet** → Run workflow.
   - `sha` = the immutable `sha-<commit>` tag to vet; `confirm_target` = `env-staging.seqtoid.org` (exact).
3. Watch: the candidate provisions (`gauntlet-<sha>.dev.seqtoid.org`), the tiers run, and on a green
   board the `attest` job writes the `gauntlet-passed` attestation. `teardown` then reaps the candidate.
4. Sanity-check the reaper: Actions → **Gauntlet candidate TTL reaper** → Run workflow with
   `dry_run: true` — it should report the candidate dir empty (or only a live in-flight candidate).

## Step 4 — Cutover: pin env-staging to a vetted immutable sha

env-staging currently runs the mutable `latest` tag. **Do not hand-edit `staging.yaml`** — the pin is
produced safely by a promotion, which copies the exact vetted image into the staging registry *before*
writing the tag:

1. Run the gauntlet (Step 3) on the sha you want env-staging to run, to a green board (attestation exists).
2. Dispatch `gitops-promote` `dev → staging`:
   - It verifies the `gauntlet-passed` attestation, `cosign copy`s the image+attestation into the
     staging registry, and opens a promote PR that sets `staging.yaml` `image.tag` to that `sha-<commit>`.
3. Merge the promote PR → Argo syncs → env-staging rolls onto the immutable sha.
4. The `argocd-ci` immutability guard now reports **OK** (sha) instead of the `latest` warning.

From here, every env-staging image has cleared the full gauntlet and is an immutable, attested digest.

## Step 5 — warn → enforce (deliberate, gated)

After a clean warn-mode window on env-staging (admission logs show no unexpected warnings):

1. Edit `deploy/argocd/policies/gauntlet-clusterimagepolicy.yaml`: `mode: warn` → `mode: enforce`.
2. Merge → sync to the staging cluster. env-staging now **rejects** any seqtoid-web image that is not
   both build-signed and gauntlet-attested.

## Rollback

- **Disable everything:** set `STAGING_GAUNTLET_ENABLED=false` (stops the gauntlet + reaper). Drain any
  live candidate first (reaper or `bin/gauntlet_env down <env>`), since disabling also stops the reaper.
- **Relax admission:** flip the policy back to `mode: warn` (or remove the namespace label) to stop denials.
- **Unpin:** a promotion only ever writes an immutable sha; to move env-staging, run another
  gauntlet-vetted promotion (never revert `staging.yaml` to `latest` — the guard will flag it).

## Quick reference — the gate in one line

Build signs the digest → **gauntlet** attests `gauntlet-passed` on a 100% green board → **promote**
verifies the attestation, copies the image to the staging registry, and pins the sha → **admission
policy** refuses anything in env-staging that isn't signed **and** attested.

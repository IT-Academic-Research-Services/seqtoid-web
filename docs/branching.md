# Branching + promotion model

How code moves from a laptop to the shared dev environment, and what each branch
means. This is the *flow*; for PR shape/scope discipline see
[`../CONTRIBUTING.md`](../CONTRIBUTING.md), and for the deploy/promotion *mechanics*
see [`DEPLOY-METHODS.md`](DEPLOY-METHODS.md), [`DEPLOY-PROMOTION.md`](DEPLOY-PROMOTION.md),
and [`ARTIFACT-PROMOTION.md`](ARTIFACT-PROMOTION.md).

> **TL;DR:** Branch off `integration`. Open a small PR back into `integration` -- it
> spins up an isolated per-PR preview sandbox you can upload to and run pipelines in.
> `integration` is the active development trunk; the only thing it does is host those
> sandboxes and accumulate reviewed work. On a **weekly cadence** the good-to-go state
> of `integration` is promoted to `main`, and `main` auto-deploys to the shared **dev**
> environment. `main` then promotes forward through **staging -> prod** on the gated
> chain. `main` is always the known-good trunk.

---

## The picture

```
  feature/bug/improvement       PR      integration      weekly       main       auto      dev (shared)
  branch off integration  ----------->  (dev trunk +  ----------->  (known-good  ------->  dev.seqtoid.org
  (cat-NNN-slug)              |          preview        promotion    weekly           |
                             |          sandboxes)     (automated)  roll-up)          |
                             v                                                        v
                    per-PR PREVIEW sandbox                              main --gated--> staging --gated--> prod
                    pr-N.dev.seqtoid.org                                (deploy-promote, digest-pinned)
                    (own app + DB + S3;
                     shared dev Batch/SFN backend)
```

- **`integration` = the active development trunk.** Feature PRs branch off it and merge
  back into it. Its *only* job is to host the per-PR preview sandboxes and accumulate
  reviewed changes between promotions. It does **not** deploy to any persistent
  environment.
- **`main` = known-good.** It is the weekly roll-up of `integration`, and the only
  branch that auto-deploys to the shared **dev** environment (`dev.seqtoid.org`) via
  GitOps (`gitops-advance-dev.yml` -> Argo CD). Nothing else touches the dev pipeline.
- **feature branches** are where you work: `cat-NNN-short-slug` off `integration`.

---

## The dev inner loop (what you actually do)

1. **Branch off `integration`:** `git switch -c cat-NNN-short-slug origin/integration`
   (naming + one-concern rules: [`../CONTRIBUTING.md`](../CONTRIBUTING.md)). You build on
   the latest in-flight state, so your PR is a clean increment.
2. **Validate locally first:** `make ci-local` -> green in Docker **before** you push.
   CI is the final gate, not your dev loop.
3. **Open a small PR into `integration`.** Label it `preview` to get a sandbox. This
   triggers:
   - the required checks (`Javascript`, `Ruby Test (MySQL 8)` shards 1-4,
     `Collate coverage + regression gate`) + 1 review, and
   - a **per-PR preview build** (`build-pr-preview.yml`) that pushes an isolated
     image, which the preview sandbox deploys.
4. **Use your preview sandbox** at `pr-N.dev.seqtoid.org`: it has its **own** app, DB
   schema, and S3 prefix, so you can upload samples and run pipelines end-to-end
   without touching anyone else's data. It dispatches to the **shared dev** Batch/Step
   Functions backend and loads results back into **your** sandbox DB only.
5. **Merge to `integration`** once green + reviewed. The sandbox is torn down when the
   PR closes or the `preview` label is removed.

## Promotion

### `integration` -> `main` (weekly, automated)

A scheduled workflow (`promote-integration-to-main.yml`) promotes the green state of
`integration` to `main` on a **weekly cadence**. The promotion is the release event
that makes something "known-good" and sends it to dev. Because every change in
`integration` was already reviewed and green on its own PR, the weekly roll-up is an
aggregation of already-vetted work.

### Keeping `integration` current with `main` (back-sync + drift guard)

Anything that lands on `main` outside the weekly roll-up -- a hotfix, or CI/infra work
merged direct -- is back-synced to `integration` by `sync-main-to-integration.yml` (it
fast-forwards `integration` to `main` when possible, else opens a `gitops/sync-*` PR).

The subtle failure this does **not** catch on its own: a workflow fix on `main` can be
**silently reverted on `integration`** when a long-lived feature branch that predates the
fix merges in carrying the OLD `.github/workflows/*` version. Because `integration`'s
workflows gate every PR into `integration`, that silent regression re-arms real breakage
with no signal (it happened once -- the `ci-test` concurrency fix was clobbered by an
unrelated merge and only caught by hand). Two guards protect against it:

- **`workflows-drift-guard.yml`** (scheduled + on push to `integration`) fails loudly when
  any `.github/workflows/**` file on `integration` is missing a commit that exists on
  `main` (i.e. `integration` is *behind* on that file). It deliberately stays quiet when
  `integration` is merely *ahead* (unpromoted feature work touching a file `main` never
  changed). Remediate by running `Sync main -> integration`.
- **`CODEOWNERS`** marks `/.github/workflows/` so a reviewer sees any workflow change --
  effective once the branch's protection rule enables "Require review from Code Owners".

### Hotfix (expedited promotion)

An urgent dev fix does **not** wait for the weekly cron. It still flows **through
`integration`** (so it gets a preview sandbox and the normal checks + review), then a
person triggers the **same** promotion workflow off-cycle via `workflow_dispatch`
(the "kick it off manually" path). This keeps one promotion path with two triggers --
`schedule` (weekly) and `workflow_dispatch` (hotfix) -- rather than a second, divergent
route. A commit-message suffix is deliberately **not** used: a manual dispatch is
explicit, permission-gated, and auditable.

### `main` -> dev (automatic)

A green `main` build advances the dev image tag via GitOps and Argo rolls it out
(blue/green with a smoke gate). `main` only moves on promotion, so dev updates on the
promotion cadence (weekly by default, or immediately on a hotfix dispatch).

### `main` -> staging -> prod (gated)

The gated, digest-pinned promotion chain -- the exact tested artifact is walked
forward, each tier behind a GitHub Environment approval. See
[`DEPLOY-PROMOTION.md`](DEPLOY-PROMOTION.md) + [`ARTIFACT-PROMOTION.md`](ARTIFACT-PROMOTION.md).
Prod is never deployed directly.

---

## Branch protection (enforced)

On `thorvath-slower/seqtoid-web`:

- **`integration`** requires the full required status checks above, at least 1
  approving review, and no force-push / no deletion. This is where features land.
- **`main`** takes changes **only** via the `integration -> main` promotion (no direct
  pushes, no feature PRs), requires the same status checks green, and no force-push /
  no deletion. Nothing reaches dev without having gone through `integration` first.

---

## Notes

- **The end-state** is to stand this same model up on the IT-ARS (UCSF) repos so the
  whole team works against that pipeline directly (or pushes local fixes up to it to
  run through the sandboxes). The retired `modernization` snapshot branch is no longer
  used.
- `integration` is periodically fast-forwarded to `main` after a promotion so the two
  never drift apart in the "main-only" direction.

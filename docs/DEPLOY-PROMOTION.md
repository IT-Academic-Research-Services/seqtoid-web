# Promoting to production — the gated dev → staging → prod chain

Production is **never deployed directly**. It is reachable only through the promotion workflow
(`deploy-promote.yml`), which walks a change through every lower tier first and gates prod on success.

> Everyday dev/staging/sandbox deploys use the **Deploy** workflow (`deploy.yml`), which *blocks* `prod` as a
> destination. See `docs/DEPLOY-METHODS.md` for the day-to-day deploy + rebuild paths.

---

## The chain

```
guard (type "promote")
  → deploy dev
    → deploy staging        (needs dev)
      → verify staging       (Playwright smoke — needs staging)
        → deploy prod        (needs smoke)   ← also pauses for a required reviewer
```

Each job `needs:` the previous, so **prod is unreachable unless dev + staging both deployed green and the
staging smoke suite passed.** Smoke (not full e2e) is the prod gate — it's the fast, stable signal; gating prod
on flakier e2e would block legitimate promotions. (Run full e2e against staging via `deploy.yml` when needed.)

## Run a promotion

1. Actions → **deploy — promote (dev → staging → prod)** → *Run workflow*.
2. Fill in: `source` (branch/tag/sha to promote), `deployment_reason`, and `confirm` = **`promote`** (a typo-guard
   so a promotion can't start by accident).
3. Watch it walk the tiers. If any tier fails, the chain stops there and prod is never touched.

---

## The two prod gates

| Gate | What it enforces | Where |
|---|---|---|
| **Ordering** (automatic) | prod can't run unless dev + staging deployed and staging smoke passed | the `needs:` chain above |
| **Required reviewer** | a human must approve before the prod job runs | the prod job's `environment: prod` |

The `deploy-prod` job (via `reusable-deploy-workflow.yml`) already references `environment: prod`. That makes
GitHub pause the job for an approval **once the protected `prod` Environment with a required reviewer exists**.
Until it's created, `environment: prod` is a no-op and only the ordering gate applies.

### Create the protected `prod` environment (repo admin, one-time)

```bash
# 1. Get the reviewer's user id (or use a team — see the API docs for team reviewers):
gh api users/<github-login> --jq .id

# 2. Create + protect the `prod` environment, requiring that reviewer to approve prod deploys:
gh api -X PUT repos/thorvath-slower/seqtoid-web/environments/prod \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "wait_timer": 0,
  "reviewers": [ { "type": "User", "id": <REVIEWER_USER_ID> } ],
  "deployment_branch_policy": null
}
JSON
```

- After this, every prod deploy (promotion) **pauses for the named reviewer's approval** before it runs.
- Add more reviewers by listing additional `{ "type": "User"|"Team", "id": … }` entries.
- A real promotion also needs AWS OIDC (`PROD_AWS_ROLE`), `GH_DEPLOY_TOKEN`, and prod cluster access wired in
  the repo's secrets/environments — the ordering + reviewer gates here hold regardless.

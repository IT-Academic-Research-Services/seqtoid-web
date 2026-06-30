# Testing — local suite + CI gate

Two layers keep egregiously-broken code out of `main`:

1. **Local** — run the same checks CI runs, before you push (`make check`, plus an optional pre-push hook).
2. **CI + branch protection** — the authoritative gate; nothing merges to `main` until it's green.

---

## Run it locally

```bash
make check           # full suite: ruby (Docker) + js/ts + python — mirrors CI
make check-fast      # eslint + tsc + flake8 only — seconds, no Docker
./bin/check-all js   # just one layer: ruby | js | python
```

`make check` is the local equivalent of the CI gate — **get it green before pushing.**

### What each layer runs (and the CI workflow it mirrors)

| Layer | Runs | CI workflow (single source of truth) |
|---|---|---|
| `ruby` | `bin/ci-local` → RSpec vs MySQL 8 in Docker (via `bin/ci-test`) | `ci-test-mysql8.yml` |
| `js`/`ts` | `npm ci`, eslint (+ a11y), `tsc --noEmit`, jest | `check.yml` → `javascript` |
| `python` | flake8, `unittest discover -s test/python` | `check.yml` → `python` |

The `ruby` layer shares `bin/ci-test` with CI, so local and CI **cannot drift**. The `js`/`python` commands
match `check.yml` step-for-step. `--fast` drops the slow bits (Docker RSpec, jest, unittest) and runs only the
lint + type-check, for a quick pre-push sanity pass.

---

## Opt-in pre-push hook

A fast guard that runs `make check-fast` before every push, so egregiously-broken code never leaves your machine:

```bash
make install-git-hooks      # or: bin/install-git-hooks
```

- Runs eslint + tsc + flake8 (~seconds). Bypass a single push with `git push --no-verify`.
- Opt-in (sets `core.hooksPath=.githooks`); uninstall with `git config --unset core.hooksPath`.
- A fast net, **not** the gate — CI is authoritative.

---

## What runs on a PR (the CI gate)

Every PR automatically runs:

| Check | What it gates |
|---|---|
| `ci-test-mysql8` | Rails suite vs MySQL 8 |
| `check` → javascript | eslint, a11y, tsc, depcheck, jest, ts-peek |
| `check` → python | flake8, unittest |
| `pull-request-only` | brakeman + rubocop (reviewdog inline annotations) |
| `security-scan` | gitleaks (hard-fail on new secrets) + trivy (report-only) |

---

## The authoritative guard: branch protection on `main`

A local hook can be bypassed — the thing that actually stops egregious code reaching `main` is **branch
protection requiring these checks to pass before merge**. Enable it once (repo admin):

```bash
# Replace the contexts with the EXACT check names shown in a live PR's "Checks" tab —
# GitHub matches them verbatim. This is the real main guard.
gh api -X PUT repos/thorvath-slower/seqtoid-web/branches/main/protection \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "ci-test (mysql 8)",
      "Javascript",
      "Python",
      "brakeman",
      "rubocop",
      "Secret scan (gitleaks)"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null
}
JSON
```

- `strict: true` → a branch must be up to date with `main` before merging (checks ran against the final tree).
- `required_pull_request_reviews` → at least one approving review before merge.
- **Confirm the `contexts` strings against a real PR's checks list** before applying — names that don't match
  exactly are silently ignored, which would leave the gate open.

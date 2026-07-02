# Maintenance register — seqtoid-web

**Purpose.** A complete inventory of what in this repo is kept current automatically
(SSOT version files + Renovate) versus what a human must maintain by hand, with the
exact file path and in-file location of each. If it's in the "human-maintained" table,
nothing will remind you — so this list is how we avoid silently drifting.

> ⚠️ **Renovate is configured (`renovate.json`) but the GitHub app is not enabled
> yet.** Decisive evidence: `renovate.json` sets `pinDigests: true`, yet every
> GitHub Action across the workflows is still on a floating tag. Until the app is on,
> *everything* below is effectively human-maintained. The "Automated" table describes
> the intended steady state once the app is on.

## A. Human-maintained (Renovate / SSOT cannot track these)

| # | Item | Where (path → location in file) | Why it's manual | How to update |
|---|------|--------------------------------|-----------------|---------------|
| A1 | **Ruby version duplicated outside the SSOT** | SSOT: `.ruby-version` (`3.3.6`). Hand-synced copies: `Dockerfile:2` (`FROM ruby:3.3.6@sha256:…`); `.github/workflows/check.yml:11` (`container: ruby:3.3.6`); `.github/workflows/ci-test-postgres.yml:28`; `docker-compose.ci.yml:21`. `Gemfile:25` correctly reads `ruby file: '.ruby-version'` | No Renovate manager rewrites a bare `ruby:3.3.6` container tag from `.ruby-version` | Bump `.ruby-version`, then hand-edit all four image/container refs + the base-image digest |
| A2 | **`Gemfile.lock` Ruby / BUNDLED WITH + Dockerfile bundler** | `Gemfile.lock` `RUBY VERSION` (`ruby 3.3.6p108`) and `BUNDLED WITH` (`2.5.22`); `Dockerfile:83` (`gem install bundler -v '2.5.22'`) must match `BUNDLED WITH` | Written by `bundle`, not Renovate; the Dockerfile bundler pin has to track the lock by hand | Keep `Dockerfile:83` `== Gemfile.lock` BUNDLED WITH in sync; re-`bundle` after a Ruby bump |
| A3 | **npm version pin (3 copies)** | `Dockerfile:30` (`npm i -g npm@10.9.0`); `.github/workflows/check.yml:163`; `.github/workflows/prettier-eslint-fix.yml:49`. Contract in `package.json` (`"npm": ">=10 <11"`) + `.npmrc` (`engine-strict`) | No Renovate manager bumps a hardcoded global `npm@` install string | Hand-edit all three together |
| A4 | **`awscli` pin in `requirements.txt`** | `requirements.txt` (`awscli==…`, with rationale comment) | App shells out to the `aws` CLI **binary**; aegea 4.x dropped the transitive dep, so this must stay explicitly declared or the binary vanishes from prod + CI. Renovate *bumps* it, but a human must never delete the line | Keep the explicit pin; bump deliberately, never remove |
| A6 | **Forked GitHub Action (moving-tag SSOT)** | `.github/workflows/check.yml` → `uses: thorvath-slower/flake8-action@v2` | The `v2` moving tag in the fork is itself the SSOT; Renovate won't manage a self-owned moving tag | Move the `v2` tag in the fork repo; no edit needed here |
| A7 | **Unpinned runtime-tool downloads in Dockerfile** | `Dockerfile` → samtools tarball URL (~line 16), chamber binary URL (~line 36), mysql-community-client (~line 65) | `curl`/`wget`/`dpkg` downloads, not a manifest — Renovate parses only `@sha256` on `FROM` | Bump the version string in each URL by hand |
| A8 | **CI bespoke logic / thresholds** | `.github/workflows/check.yml` — ESLint `--max-warnings`, a11y `--max-warnings`, depcheck gate, lockfile-version check, `bin/ts-peek.sh`; dummy CI secrets | Workflow logic + warning budgets; nothing auto-updates these | Edit by hand as the codebase changes |
| A9 | **Frontend `tsc` type-check (not a default PR gate)** | `package.json` (`"type-check": "tsc -p ./app/assets/tsconfig.json --noemit"`); run only in `check.yml`, which triggers on `workflow_dispatch` | Per project convention CI does not auto-run `tsc` on PRs — it's a human/local step | Run `npm run type-check` locally before pushing |
| A10 | **npm peer-deps quirk (`legacy-peer-deps`)** | `.npmrc` (`legacy-peer-deps = true`, with rationale) | Workaround keeping the legacy frontend installable under npm 10 (`@sentry/react@5` peer mismatch) | Remove only after upgrading `@sentry/react` to a react-18 major |
| A11 | **Database config (MySQL→PostgreSQL migration)** | `config/database.yml` (`adapter: postgresql`, `sslmode`, env-var contract `DB_*`/`RDS_ADDRESS`); note `check.yml` test service still uses `bitnamilegacy/mysql:5.7` | Adapter/connection contract is hand-authored; mid-migration so both DBs coexist | Edit by hand as the migration proceeds |
| A12 | **chamber / SSM secret references + env contract** | `bin/entrypoint.sh`, `bin/deploy`, `bin/connect_to_ecs.sh`, `bin/manual_deploy_scripts/*` (chamber invocations); chamber install `Dockerfile:36` | Secret-name / SSM-path contracts; nothing tracks these | Keep in sync with the SSM parameter store by hand |
| A13 | **Hardcoded AWS identifiers / buckets / ARNs / domains** | `web.env` (account ID, S3 bucket names, `AWS_REGION`, `CLI_UPLOAD_ROLE_ARN`, `SFN_NOTIFICATIONS_QUEUE_ARN`, Auth0 domains); `Makefile` (`AWS_DEV_PROFILE`, `AWS_REGION`) | Infra identifiers in config/env; no updater | Edit by hand on infra changes |
| A14 | **ECS task / service definitions** | `czecs.json`, `czecs-resque.json`, `czecs-shoryuken.json`, `czecs-task-migrate.json` (repo root) | Deploy manifests with image refs, env, resources | Edit by hand |
| A15 | **Python `target-version` for tooling** | `pyproject.toml` (`target-version = ['py37']` — lags the runtime `.python-version`) | black target is a manual tooling choice, decoupled from the interpreter SSOT | Bump deliberately when ready |

## B. Automated — SSOT version files + Renovate

| # | Item | Where (path → location in file) | Maintained by |
|---|------|--------------------------------|---------------|
| B1 | **Runtime version SSOT files** | `.ruby-version` (`3.3.6`), `.node-version` (`20.20.2`), `.python-version` (`3.12`) | SSOT, consumed by CI via `ruby/setup-ruby` (auto-reads `.ruby-version`), `setup-node` `node-version-file`, `setup-python` `python-version-file`, and `Dockerfile` (reads `.node-version`). **Renovate has no manager for these bare files** — SSOT-by-reference, human-bumped but consumed automatically everywhere (see A1 for the Ruby copies that still need hand-sync) |
| B2 | **Ruby gems** | `Gemfile`, `Gemfile.lock` | Renovate `bundler` manager (group "ruby gems") |
| B3 | **npm packages** | `package.json`, `package-lock.json`. Note: `@aws-sdk/client-s3` is **exact-pinned** (no `^`) — its `@smithy/*` base classes must resolve as one coherent tree, and a floating range previously caused an ES5/ES6 class-inheritance crash; Renovate's grouped "npm packages" PRs bump it forward in lockstep | Renovate `npm` manager (group "npm packages") |
| B4 | **Python requirements** | `requirements.txt`, `requirements-dev.txt` (incl. the `awscli` version bumps — never its *removal*, A4) | Renovate `pip_requirements` manager (group "python deps") |
| B5 | **GitHub Actions `uses:` pins** | `.github/workflows/*.yml` (`uses:` lines) | Renovate `github-actions` manager + `pinDigests:true`. **Currently all floating tags — strongest signal the app isn't running yet** |
| B6 | **Dockerfile base-image digest** | `Dockerfile:2` (`FROM ruby:3.3.6@sha256:…`) | Renovate `dockerfile` manager + `pinDigests:true`. Only `FROM` is in scope; the `curl`/`wget` tool downloads are not (A7) |
| B7 | **Vulnerability alerts** | GitHub security advisories | `renovate.json` → `vulnerabilityAlerts.enabled` |

> **Local pre-push gate (human, not Renovate):** `make ci-local` → `bin/ci-local` runs the full Postgres CI suite in Docker. Green this before pushing.

## When you add something, update the register

If you add a hardcoded version (esp. a Ruby/npm copy that must be hand-synced), a new
vendored dep, a new SSM/secret reference, a new bucket/ARN/domain, or a new CI threshold —
add a row to **table A**. If you bring a new manifest under a Renovate manager, add it to
**table B**. The cost of a missing row is silent drift.

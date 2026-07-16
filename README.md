# seqtoid-web

**The web application for the seqtoid infectious-disease sequencing platform** — where scientists upload
metagenomic sequencing data, run it through bioinformatics pipelines, and explore the results (which
pathogens were found, at what abundance and confidence).

> **Naming:** the platform is being renamed to **seqtoid**. This repository uses the seqtoid name in prose;
> **functional/external** references are intentionally kept — the live product site (`czid.org`), the upstream
> `github.com/chanzuckerberg/czid-*` repos, the logo assets, and AWS resource names (e.g. `idseq-web`,
> `idseq-samples-*`) still use the legacy names until a coordinated cutover. **The repo itself is not being
> renamed** as part of documentation work.

This README is the onboarding guide: read it top-to-bottom and you should be able to run, understand, and
own this repo. Deeper references: [`DEVELOPMENT.md`](DEVELOPMENT.md) (all dev commands) and
[`MANUAL-DEV-DEPLOY-RUNBOOK.md`](MANUAL-DEV-DEPLOY-RUNBOOK.md) (deploy).

---

## 1. Where this fits in the platform

seqtoid is several repositories working together. `seqtoid-web` is the **user-facing app + orchestration**;
it dispatches the actual science to the workflow layer and reads results back.

| Repo | Role |
|---|---|
| **seqtoid-web** (this) | Rails+React app: auth, upload, metadata, dispatch pipelines, serve results |
| **seqtoid-workflows** | The WDL/miniwdl bioinformatics pipelines (short/long-read mNGS, consensus genome, AMR) |
| **cypherid-web-infra** | App-tier Terraform (CloudFront, Aurora MySQL 8, app S3, ECS, networking) |
| **cypherid-workflow-infra** | Workflow-tier Terraform (AWS Batch / SWIPE, WDL dispatch, taxon/WDL buckets) |
| **seqtoid-ssot-infra** | Single-source-of-truth foundation IaC — shared Terraform modules + remote state others consume |
| **seqtoid-ci-workflows** | Reusable GitHub Actions / security-CI + the in-house `flake8-action` (the CI SSOT; formerly `ci-workflows`) |
| **cztack** | In-house private fork of shared Terraform modules (pinned by SHA) |

> IaC across the platform is **native Terraform** (an earlier OpenTofu migration was reverted). See the
> platform architecture + SSOT guide for how these interrelate and where the SSOT lives.

## 2. Architecture & components

**Backend** — Ruby **3.3.6**, Rails **7.1.6**, MySQL **8.0** (Aurora in AWS).
- **GraphQL** (`graphql-ruby` 2.6) served **natively from Rails** (`app/graphql/`) — the former NextGen
  GraphQL-federation layer has been removed; there is no separate federation server.
- **Auth** via **Auth0** (OmniAuth + JWT).
- **Background jobs** via **Resque** + **Shoryuken** (SQS) on **Redis**.
- **Search** via OpenSearch/Elasticsearch.
- **Storage** on **S3** (browser → S3 multipart uploads with an app-owned resumable uploader).
- **Pipeline dispatch** via **AWS Step Functions** running the **SWIPE** engine (miniwdl).

**Frontend** — **React 18** + **TypeScript**, **Relay** (GraphQL client), Material-UI v5 + the CZI design
system, bundled with **Webpack** (Node **20**). Source in `app/assets/src/`.

## 3. How it works — the core data path

The single most important flow (and the one that must never break):

```
Browser upload ──▶ S3 (multipart, accelerate) ──▶ markSampleUploaded (Rails)
      ──▶ Resque enqueues ──▶ Step Functions (SWIPE) runs the mNGS WDL
      ──▶ host-filter ▶ non-host alignment (NT/NR) ▶ post-process ▶ HandleSuccess
      ──▶ results ingested to MySQL ──▶ report rendered in-app (/samples/:id)
```

A successful run produces a taxon report (reads-per-million, alignment metrics, etc.) viewable in the
sample view. The upload path uses the stock AWS SDK v3 + an app-owned `ResumableUpload`
(`app/assets/src/components/views/SampleUploadFlow/.../resumableUpload.ts`).

## 4. Repository layout

```
app/
  controllers/      # REST + web controllers
  models/           # ActiveRecord (Sample, Project, PipelineRun, WorkflowRun, TaxonCount, User)
  services/         # business logic
  jobs/             # Resque/Shoryuken background jobs
  graphql/          # Rails-native GraphQL schema (queries/mutations/types)
  assets/src/       # React/TypeScript frontend
config/             # Rails config (database.yml, initializers, environments)
db/                 # migrations + seeds
spec/               # RSpec (backend)
jest/               # Jest (frontend)
e2e/                # Playwright end-to-end
bin/deploy          # ECS deploy (czecs); bin/verify-bundle.sh gates the shipped frontend bundle
```

## 5. Getting started (local development)

**Prerequisites:** Docker (BuildKit), Ruby 3.3.6, Node 20, `make`. Config lives in `web.env` for local dev.

```bash
make local-init            # one-time: build containers + set up
make local-db-setup        # create DB + seed
make local-start-webapp    # app + webpack dev server -> http://localhost:3001
```

Other useful targets: `make local-migrate`, `make local-console` (bash in web container),
`make local-railsc` (Rails console), `make local-dbconsole`. Full list: `make help` / `DEVELOPMENT.md`.

For the **fast inner loop** (what needs a rebuild vs. what's live-mounted) and the
**no-AWS `OFFLINE=1` harness** (run + test the app with no cloud creds), see
[`docs/LOCAL-DEV.md`](docs/LOCAL-DEV.md).

## 6. Build, test & quality gates

```bash
# frontend
npm run type-check        # tsc
npm run lint              # eslint
npm test                  # jest
npm run build-img         # production frontend bundle

# backend
make rspec                # RSpec
bundle exec rubocop       # Ruby style (run before committing Ruby)
```

CI ("idseq-web check") runs: Javascript (jest + eslint), Ruby Test (MySQL 8), Python, rubocop, brakeman,
gitleaks, and a Trivy dependency scan. `make check` gives local parity.

## 7. Runbook — deploy & operate

Current production topology is **ECS** (an EKS cutover is planned but not yet live). Deploys mirror the
chanzuckerberg `bin/deploy` (czecs) flow, run manually — see
[`MANUAL-DEV-DEPLOY-RUNBOOK.md`](MANUAL-DEV-DEPLOY-RUNBOOK.md). In short (dev):

```bash
SHA=$(git log -n1 --format=%h --abbrev=8)
IMG=<acct>.dkr.ecr.us-west-2.amazonaws.com/idseq-web:sha-$SHA
DOCKER_BUILDKIT=1 docker build --platform linux/amd64 -t "$IMG" .
bin/verify-bundle.sh --image "$IMG"          # assert the built frontend bundle matches source
docker push "$IMG"
AWS_PROFILE=idseq-dev bin/deploy dev sha-$SHA "you"
bin/verify-bundle.sh --url https://dev.seqtoid.org   # assert the CDN serves the new bundle
```

**Services (per env, ECS):** `idseq-<env>-web`, `idseq-<env>-resque` (+ `-scheduler`,
`-pipeline-monitor`, `-result-monitor`), `idseq-<env>-shoryuken`. The migration task runs as part of deploy.

**Troubleshooting:**
- Errors surface in **Sentry** (org `ucsf-rm`). Runtime jobs (`pipeline_monitor`/`result_monitor`) shell out
  to the `aws` CLI — it must be on the image PATH (pinned in `requirements.txt`).
- Pipeline runs are AWS Step Functions executions (`idseq-swipe-<env>-short-read-mngs-wdl`); a mid-run
  spot-instance reclaim auto-falls-back to on-demand (normal).
- A stale served bundle after deploy → re-run `bin/verify-bundle.sh --url`; the `app/assets/dist` build is
  `.dockerignore`d so a stale local copy can't ship.

## 8. Conventions

- **Small, single-concern PRs**; validate locally (Docker) before pushing — CI is the final gate.
- Branch off **`integration`**, open a PR into `integration` (not `main`).
- MySQL 8 is required (uses `ROW_NUMBER()` window functions; breaks on 5.7).

---

**About seqtoid:** a hypothesis-free global platform to identify pathogens in metagenomic sequencing data —
**Discover** the pathogen landscape, **Detect** and review potential outbreaks, **Decipher** infecting
organisms in large datasets. A collaborative open project of the
[Chan Zuckerberg Initiative](https://www.chanzuckerberg.com/) and [CZ Biohub](https://czbiohub.org).

**More:** [`DEVELOPMENT.md`](DEVELOPMENT.md) · [`MANUAL-DEV-DEPLOY-RUNBOOK.md`](MANUAL-DEV-DEPLOY-RUNBOOK.md) ·
the platform architecture + SSOT guide (cross-repo).

<!-- e2e pipeline test 2026-07-16: exercising the IT-ARS CI/CD pipeline end-to-end (feature -> integration -> preview -> roll-up -> deploy). Safe no-op marker. -->

<!-- demo sandbox marker: 2026-07-16 upload verification (platform-overhaul #697) -->

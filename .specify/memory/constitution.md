# CZ ID Platform Constitution

> **Shared across all five repos** (`cypherid-web-infra`, `cypherid-workflow-infra`, `seqtoid-web`, `seqtoid-workflows`, `seqtoid-graphql-federation-server`). This is the single, identical `.specify/memory/constitution.md` installed in every repo so the whole platform shares one set of goals and themes. Repo-specific rules go in a short `## Repo Addendum` at the bottom of each repo's copy — the Core Principles never diverge.

## Mission

Overhaul the CZ ID stack into a **portable, sellable, privacy-first platform** that stands up from one action, ships by push-button graceful blue/green, manages secrets centrally, and can be self-hosted and owned outright by customers. Ethos: **Buy Once. Own Forever. No Subscriptions. No Cloud lock-in. No Data Mining.**

## Core Principles

### I. Portability First (NON-NEGOTIABLE)
No AWS-proprietary service or single-cloud assumption may be a hard dependency of the shipped product. Anything that can't run in the self-hosted k3s appliance — air-gapped — does not belong in the portable path. Managed cloud services are an *option*, never a requirement.

### II. Open & Redistributable Licensing (NON-NEGOTIABLE)
Only licenses that permit embedding and redistribution in a sold product (MPL, Apache-2.0, BSD, MIT) ship in the product. No BUSL/SSPL-encumbered components (hence OpenTofu over Terraform, OpenBao over Vault). Licensing is checked at the `/speckit.plan` gate.

### III. One Source of Truth → Profiles
A single Helm chart + value profiles + OpenTofu modules produces every edition and deployment model (cloud/appliance; MSP/binary/multi-tenant) by configuration. **No codebase forks.** New capability must be expressible as a profile/toggle, not a branch of the product.

### IV. Instrument Once, Observe Everywhere
All telemetry is **OpenTelemetry**; the OpenTelemetry Collector is the only thing that changes to redirect it. Observability (metrics, logs, traces, SLOs) ships in every profile — full in cloud, lite in the appliance — and can be pointed at a customer's own backend without code changes.

### V. Graceful & Reversible Delivery (NON-NEGOTIABLE)
No deploy drops an active client. Blue/green with an analysis gate, graceful drain (in-flight requests finish), and automatic rollback are mandatory. Every state-changing or data-changing operation has a backup and a rollback path; foundational resources carry `prevent_destroy`.

### VI. Privacy & Local-First for the Appliance
The appliance is the customer's own box: air-gap capable, minimal/no phone-home, customer owns all data. Bundled identity (Keycloak), secrets (OpenBao), and database (CloudNativePG) so it needs nothing external.

### VII. Least Privilege & Secure by Default
Scope every IAM/OpenBao policy narrowly; deny by default; no static long-lived credentials where dynamic/short-lived ones exist (GitHub Actions → AWS via OIDC; dynamic DB creds). Secrets are never committed and are rotated.

### VIII. Functional Parity
The overhaul preserves application behavior. The only deliberate behavioral change is the multi-tenant boundary, which is its own scoped initiative and must prove isolation before it ships.

## Technology Constraints

Locked stack (decisions, not options): **Kubernetes + Helm · OpenTofu · OpenBao · Argo CD + Argo Rollouts · PostgreSQL** (CloudNativePG in the appliance) **· Auth0 behind a generalized OIDC boundary** (customer-OIDC option; bundled-Keycloak edition) **· GitHub + GitHub Actions** (CI) **· Artifactory + Packer · OpenTelemetry + Prometheus/Loki/Tempo/Grafana**. Two editions (cloud EKS / k3s appliance) from one chart.

## Development Workflow

- **Spec-driven:** every work item flows `/speckit.constitution` → `/speckit.specify` → (`/speckit.clarify`) → `/speckit.plan` → `/speckit.tasks` → (`/speckit.analyze`) → `/speckit.implement`. Specs describe **what & why**, never how.
- **Branching:** `main` is the source of truth. Every work item is a **fresh branch cut from latest `main`**; existing branches are never renamed or rewritten. Naming:
  - `feature-#NNN-<slug>` — net-new capability · commit `feature-#NNN: <name>`
  - `improvement-#NNN-<slug>` — refactor/enhance existing · commit `improvement-#NNN: <name>`
  - `bug-#NNN-<slug>` — fix a defect/security/EOL/correctness issue · commit `bug-#NNN: <name>`
  - The Spec Kit spec directory `specs/NNN-<slug>/` shares the number with its branch.
- **Gated items** (Postgres migration, blue/green cutover) carry strict verification gates and must land by their deadline.
- **TDD where it earns its keep:** the gated and reporting-path items ship with parity/isolation tests written first.

## Governance

This constitution supersedes other practices. Amendments require a documented rationale, a version bump, and propagation of the updated file to **all five repos** (the constitution is identical everywhere). All `/speckit.plan` runs include a Constitution Check; violations must be justified in the plan's Complexity Tracking or the approach changed.

**Version**: 1.0.0 | **Ratified**: 2026-06-10 | **Last Amended**: 2026-06-10

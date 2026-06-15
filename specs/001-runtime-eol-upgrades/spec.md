# Bug Specification: Runtime EOL upgrades — Ruby / Rails / Node (bugs #001–#004)

**Branch**: `bug-#001-runtime-eol-upgrades`  ·  **Spec dir**: `specs/001-runtime-eol-upgrades/`

**Created**: 2026-06-11 · **Status**: Draft · **Repo**: `seqtoid-web`

**Input**: The web app pinned three end-of-life runtimes — Ruby 3.1.6, Rails 7.0, Node 16 — plus their EOL base image. Upgrade them thoroughly across **every** pin and prove the app still builds/loads, per Tom's directive ("don't half-do it; test via Docker").

## Why

EOL runtimes stop receiving security patches. This closes bugs **#001** (Ruby 3.1), **#002** (Rails 7.0), **#003** (Node 16), and the Ruby/Node halves of **#004** (EOL base images).

## Target versions (conventional, low-risk steps)

| Runtime | From | To | Note |
|---|---|---|---|
| Ruby | 3.1.6 | **3.3.6** | Tom-validated to build cleanly here; digest-pinned base. |
| Rails | 7.0.8.4 | **7.1.6** | One minor step (never skip); `rspec-rails 5.1 → 6.1` (the 7.1-compatible line). |
| Node | 16.15.0 | **20.18.1** | Current LTS (18 is also near-EOL). |
| npm | 8.5.5 | **10.9.0** | Ships with Node 20. |

## Every pin updated

`.ruby-version`, `.node-version`, `Gemfile` (`ruby file: '.ruby-version'` + Rails/rspec-rails), `Gemfile.lock`, `package.json` (`engines`), `package-lock.json`, `.npmrc`, `Dockerfile` (`FROM ruby:3.3.6@sha256:…` digest-pinned, `setup_20.x`, `npm@10.9.0`), and both CI workflows (`check.yml` container + `node-version`, `prettier-eslint-fix.yml`).

## Notable changes forced by the upgrade

- **`.npmrc` `legacy-peer-deps=true`**: npm 10 enforces peer deps strictly; the legacy frontend tree trips on it (e.g. `@sentry/react@5` declares peer `react 15–17` while the app is on react 18). This preserves the previously-working resolution. *Follow-up:* upgrade `@sentry/react` to a react-18 major and drop this.
- **Retired `npm-force-resolutions`**: the `preinstall: npx npm-force-resolutions` hook **fails under npm 10** and produced a lockfile npm 10's `npm ci` rejects. Replaced with npm-native **`overrides`** (npm 8.3+), pinning the types-only `csstype` to `3.1.2` for deterministic resolution. The empty `resolutions` placeholder was removed.
- **`package-lock.json` regenerated** (lockfileVersion 2 → **3**). Because the old lock was structurally inconsistent with npm 10's resolver, a from-scratch resolve was required; transitive deps refreshed within their existing semver ranges. This bumped TypeScript 4.6.3 → 4.9.5, which surfaced **5 latent type errors** — all fixed (see below).
- **5 TS fixes** (behavior-preserving): `rev={null}` → `rev={undefined}` (HeaderContent, StyledTableRow — newer `@types/react` types `rev` as `string|undefined`); `filesToUpload[inputFile.source!]` non-null assert (upload.ts, RemoteUploadProgressModal — `source` is optional); removed a now-unused `@ts-expect-error` (SectionsDropdown).

## Verification (Docker; Ruby 3.3.6 + Node 20.20.2 containers)

- **Ruby**: `bundle lock` → Rails 7.1.6; `bundle install` compiles all native gems under Ruby 3.3.6; `require 'rails/all'` → **"Rails 7.1.6 on Ruby 3.3.6"**.
- **Node**: `npm ci` clean (1032 pkgs, lockfileVersion 3); `tsc -p app/assets/tsconfig.json --noEmit` **clean** (no app-code errors); `jest` **9/9 tests pass** (3/4 suites).
- The full RSpec/Rails suite needs a live DB + Auth0/AWS secrets (Bucket B / real CI) — out of scope here; dependency-load + compile compatibility is proven.

## Known issues / follow-ups (not regressions of this change)

- `jest/Dumb.test.jsx` fails to load: `enzyme-adapter-react-16` is incompatible with React 18 (pre-existing; jest itself runs fine under Node 20). Tracked separately (enzyme → React Testing Library).
- Drop `legacy-peer-deps` after the `@sentry/react` upgrade.

## Scope

This covers `seqtoid-web`. The remaining `bug-#003/#004` surfaces — `seqtoid-graphql-federation-server` (Node 18→20) and `cypherid-workflow-infra` lambdas (Python 3.8, Node 18) — are smaller follow-ons in their own repos.

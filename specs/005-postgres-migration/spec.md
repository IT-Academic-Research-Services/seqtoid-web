# Improvement Specification: MySQL → PostgreSQL Migration

**Branch**: `improvement-#005-postgres-migration` · **Spec dir**: `specs/005-postgres-migration/`

**Created**: 2026-06-10 · **Status**: Draft · **Repo**: `seqtoid-web` · **🔒 Gated — tests-first, must land by end of August**

**Input**: Move `seqtoid-web` off Aurora MySQL onto PostgreSQL, preserving application behavior exactly (Principle VIII). PostgreSQL is the portable database for both editions (CloudNativePG in the appliance). The only deliberate change is the database engine; nothing about what the app computes may change.

## Why

The overhaul standardizes on **PostgreSQL** — it's portable (runs in the air-gapped k3s appliance via CloudNativePG; Principle I) and open. Today `seqtoid-web` is bound to MySQL three ways: the `mysql2` adapter, MySQL-only SQL scattered through models/services, and a fragile session-variable ranking in the hot `TaxonCount` reporting path. This slice removes all three.

Because the reporting path drives scientific results, **this is gated and tests-first**: the parity test suite is the deliverable and is written *before* any query changes. A rewrite ships only when a test proves it returns identical results to the original.

## MySQL-ism inventory (the work surface)

**Bug #010 — session-variable ranking (correctness-risky, plan-dependent):**
- `app/services/top_taxons_sql_service.rb` — `SET @rank := 0, @current_id := 0` (L81) + `@rank := IF(@current_id = pipeline_run_id, @rank + 1, 1)` top-N-per-group (L257). → `ROW_NUMBER() OVER (PARTITION BY pipeline_run_id ORDER BY …)`.
- `app/models/background.rb` — `@adjusted_total_reads := … IFNULL(…)` session-variable accumulation (L65). → window/derived column + `COALESCE`.

**Bug #011 — MySQL-only SQL (portability):**
- `GROUP_CONCAT(… ORDER BY … SEPARATOR …)` → `string_agg(… , … ORDER BY …)`: `app/models/project.rb` (L58, L70), `app/models/visualization.rb` (L49), `app/controllers/projects_controller.rb` (L113–L116).
- `IFNULL(a,b)` → `COALESCE(a,b)`: `projects_controller.rb` (L115), `background.rb` (L65).
- `JSON_EXTRACT(col,'$.x')` → `col->>'x'` / `jsonb_path_query` (and a `JSON_TABLE`-free `IN`): `app/models/workflow_run.rb` (L230, L236, L253). *(Note: requires the JSON columns to be `jsonb` on Postgres — covered under schema review.)*
- `unix_timestamp(col)` → `EXTRACT(EPOCH FROM col)`: `lib/tasks/pipeline_monitor.rake` (L193).
- Backtick identifiers (`` `rank` ``, `` `inputs_json` ``) → standard double-quotes or none.

*(Ruby `rand()` calls in `snapshot_link.rb`, `hard_delete_objects.rb`, `metadata_helper.rb` are application code, not SQL — out of scope.)*

**Adapter / schema:**
- `Gemfile`: `mysql2` → `pg`. `config/database.yml`: `adapter: mysql2` → `postgresql`.
- `db/schema.rb` + migrations: MySQL-specific types/options (e.g. `unsigned`, `tinyint(1)`, `text` limits, `COLLATE`/charset, fulltext indexes, `enum` columns), JSON → `jsonb`.
- CloudNativePG manifests for the appliance edition.
- Data cutover runbook (mysqldump → pgloader / AWS DMS), with rollback.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The TaxonCount report is identical on Postgres (Priority: P1)
As a scientist, the top-taxons report returns exactly the same taxa, ranks, and metrics on PostgreSQL as on MySQL.

**Why this priority**: It's the scientific output; any divergence is a correctness regression.

**Independent Test**: Seed identical fixtures; run `TopTaxonsSqlService` (and `fetch_top_taxons`) against both engines (or against the rewritten window-function query vs. a captured MySQL baseline) and assert row-for-row equality of `{pipeline_run_id, tax_id, count_type, tax_level, rank, rpm, zscore}`.

**Acceptance Scenarios**:
1. **Given** seeded taxon_counts across multiple pipeline runs, **When** the ranking query runs, **Then** `ROW_NUMBER()` assigns the same rank as the `@rank` version and the same rows survive `rank <= num_results`.
2. **Given** a tie in the sort metric, **When** ranking runs, **Then** behavior matches the original (no new deterministic tiebreaker is introduced unless documented).

### User Story 2 - Portable SQL everywhere (Priority: P1)
As the portable product, no MySQL-only SQL remains; every query runs on PostgreSQL.

**Independent Test**: `grep` finds zero `GROUP_CONCAT`/`IFNULL`/`JSON_EXTRACT`/`unix_timestamp`/`@var :=` in `app/` and `lib/`; the rewritten scopes return equal results to captured MySQL baselines.

**Acceptance Scenarios**:
1. **Given** the project/visualization sort scopes, **When** they run on Postgres, **Then** `string_agg` produces the same concatenated, ordered, de-duplicated strings as `GROUP_CONCAT`.
2. **Given** workflow-run JSON sorting/filtering, **When** it runs on Postgres `jsonb`, **Then** ordering and membership match the `JSON_EXTRACT` behavior.

### User Story 3 - Runs on Postgres, including the appliance (Priority: P1)
As an operator, the app boots and the suite passes on PostgreSQL, and the appliance runs CloudNativePG.

**Independent Test**: `bundle exec rspec` green against a Postgres `test` database; CloudNativePG manifests apply and the app connects.

## Requirements *(mandatory)*

- **FR-001**: Application behavior MUST be preserved exactly (Principle VIII). The DB engine is the only deliberate change.
- **FR-002**: **Tests first.** Parity tests for the ranking path and each MySQL-ism MUST be authored before the corresponding rewrite and MUST define done.
- **FR-003**: The `@rank` ranking MUST become a window function (`ROW_NUMBER()`), removing session variables and the `SET @rank` priming.
- **FR-004**: All MySQL-only SQL (inventory above) MUST be rewritten to standard/PostgreSQL SQL.
- **FR-005**: The adapter MUST be `pg`; schema/migrations MUST be Postgres-valid; JSON columns used with path ops MUST be `jsonb`.
- **FR-006**: The appliance MUST get CloudNativePG manifests; a cutover runbook with rollback MUST exist.
- **FR-007**: No raw user input may be interpolated into the rewritten SQL beyond what already exists; rewrites should not worsen the (pre-existing, TODO-flagged) injection surface.

## Success Criteria *(mandatory)*

- **SC-001**: Parity tests pass: rewritten queries equal captured MySQL baselines on seeded data.
- **SC-002**: Zero MySQL-only SQL remains in `app/`/`lib/`.
- **SC-003**: `rspec` green on PostgreSQL.

## Bucket B (Tom — live env / real data)
- Running the parity suite against **production-scale real data** and `EXPLAIN`-tuning the rewritten ranking query.
- The live data cutover (mysqldump → pgloader/DMS), the production switchover, and rollback execution.
- Applying CloudNativePG in the appliance and the real Aurora→Postgres move.

## Notes
This slice does **not** do the Ruby/Rails EOL upgrades (`bug-#001`/`#002`) — it runs on the current Ruby 3.1 / Rails 7.0. It also supersedes `bug-#005` (Aurora MySQL EOL). The `pg` gem is PostgreSQL-licensed (BSD-style) — clears Principle II.

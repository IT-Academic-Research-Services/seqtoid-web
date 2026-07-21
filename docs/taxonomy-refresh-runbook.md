# Taxonomy reference-refresh runbook (quarterly lineage)

Operating guide for the quarterly taxonomy/lineage refresh (epic #548). Generation is automated;
**adoption is human-gated** — nothing reaches prod without a scientist sign-off and a passing benchmark.
Every step is reversible and nothing is ever destroyed.

## The flow

```
generate (Batch) → 1. verify → 2. load(dev, +backup) → 3. register → 4. validate(dev)
                                                                          │ PASS
                                          [scientist sign-off + benchmark AUPR ≥ 0.98]
                                                                          │
                                                    5. cutover(dev→prod, gated) → rollback available
```

Generation (grab NCBI taxdump → parse → merge → emit `versioned-taxid-lineages.csv.gz` + changelogs to
S3) runs on the Batch-on-image job. It writes **only to S3** — it never touches a database.

## Commands (run in a seqtoid-web pod / the refresh job, per env)

Let `VER` = the new version (e.g. `2026-07-09`) and `PREFIX` = the S3 prefix holding the artifacts.

**1. Verify** — block a bad candidate before anything loads:
```
rake "taxonomy:verify[$VER,$PREFIX]"      # structural + sanity + known-panel; PASS/FAIL
```

**2. Load (dev first)** — blue/green, backs up automatically:
```
VERIFY_PASSED=1 rake "taxonomy:load[$VER,$PREFIX/versioned-taxid-lineages.csv.gz]"
# staging table → atomic RENAME swap; the old table is preserved as taxon_lineages_bak_<ts>
# optional out-of-band snapshot: TAKE_RDS_SNAPSHOT=1 RDS_CLUSTER_ID=idseq-dev ...
```

**3. Register the AlignmentConfig** (lineage-only reuses the NT/NR sequence paths):
```
BASE_CONFIG=<current default name> rake "alignment_config:register[$VER]"
```

**4. Validate on dev** — the acceptance gate:
```
rake "taxonomy:validate[$VER]"            # orphan anti-join(#528)=0 + known-panel + ES parity
# then MANUALLY: run a real sample on dev pinned to the $VER AlignmentConfig; confirm the
# report / taxonomy / heatmap render.
```

**Benchmark (biological gate, mandatory before prod):** run the Benchmark workflow against the
candidate index and confirm AUPR ≥ 0.98 (< 1% deviation). Block on regression.

**5. Cutover** — only after sign-off + benchmark PASS. Instant + reversible:
```
rake "taxonomy:cutover[$VER]"             # flips the default AlignmentConfig for NEW runs
```
Promote dev → staging → prod the same way, each behind the team-approval gate.

## Rollback (any step, no data loss)

- **DB table** (a bad load): the old table is preserved.
  ```
  rake "taxonomy:rollback[taxon_lineages_bak_<ts>]"   # parks the bad table, restores the backup
  ```
- **Cutover** (bad reference in prod): flip the default back.
  ```
  rake "taxonomy:cutover_rollback[<previous version>]"
  ```
- **ES index**: the previous index is retained; re-point the alias or rebuild
  (`TaxonLineage.__elasticsearch__.import(force: true)`).

Historical runs are pinned to their own `alignment_config_id`, so no rollback ever changes a past
result.

## Backups kept at every step
- Blue/green load renames (never drops) the old table → `taxon_lineages_bak_<ts>`.
- Old ES index retained after the alias swap.
- Optional Aurora cluster snapshot (`TAKE_RDS_SNAPSHOT=1`) before the swap.
- The generated artifacts are immutable in S3 under `ncbi-indexes-prod/<version>/`.

## Staleness alarm (the SLA)
Run on a schedule (CronJob) so the observability stack alerts when the live reference ages past the SLA
(mirror NCBI, never worse than a quarter — except the ~annual NT/NR rebuild):
```
MAX_AGE_DAYS=92 rake taxonomy:staleness    # non-zero exit + error log when stale
```

## Not yet automated (dependencies)
- **Quarterly trigger** (EventBridge → Batch, auto-generate + verify → notify for sign-off) needs the
  lineage-generation image published as a proper ECR release first (the 2026-07-09 proof image was
  built ad-hoc). Until then, kick the refresh via the refresh GitHub Action / the job manually.
- **Benchmark-as-a-gate** wiring (auto-block on AUPR regression) is a downstream enhancement; today it
  is run + read by a human.

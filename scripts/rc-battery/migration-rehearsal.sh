#!/usr/bin/env bash
# migration_rehearsal leg of the RC battery. Runs INSIDE the RC image (workdir /app, through the
# image entrypoint with OFFLINE=1, so `bundle exec` is already applied) against a THROWAWAY restored
# copy of env-prod's database given as DATABASE_URL. Never point it at a live database: step 3
# deletes schema_migrations rows on purpose.
#
# Mirrors bin/ci-migrate-check's three checks, adapted to a database that already holds prod's
# schema and data (ci-migrate-check itself drops and recreates its database, so it cannot run here):
#   1. APPLY   `rails db:migrate:with_data` -- exactly the env-prod PreSync migrate hook command
#              (prod sets migrate.seedMigrate=false, so no seed:migrate).
#   2. PARITY  the image's committed db/schema.rb vs the schema the migrated prod copy dumps.
#              Advisory, as in ci-migrate-check (known [7.0]/[7.2] dumper drift).
#   3. RE-RUN  forget the versions step 1 applied (their DDL stays) and migrate again; it must
#              converge to the same schema -- the partial-apply state an aborted deploy leaves.
set -euo pipefail

versions() {
  # shellcheck disable=SC2016
  rails runner 'puts ActiveRecord::Base.connection.select_values("SELECT version FROM schema_migrations").sort' \
    | grep -E '^[0-9]+$' || true
}
normalize() {
  sed -E 's/utf8mb3/utf8/g; s/, precision: [0-9]+//g; s/ActiveRecord::Schema\[[0-9.]+\]/ActiveRecord::Schema/' "$1"
}
dump() { SCHEMA="$1" rails db:schema:dump; }

work="$(mktemp -d)"
echo "::group::0/3 versions already applied on the restored copy"
versions > "$work/before"
echo "$(wc -l < "$work/before") versions; newest: $(tail -n1 "$work/before")"
echo "::endgroup::"

echo "::group::1/3 APPLY -- rails db:migrate:with_data"
if ! rails db:migrate:with_data; then
  echo "MIGRATION REHEARSAL FAILED: db:migrate:with_data did not apply on the prod copy." >&2
  exit 1
fi
versions > "$work/after"
comm -13 "$work/before" "$work/after" > "$work/new"
echo "applied $(wc -l < "$work/new") new version(s):"; sed 's/^/  /' "$work/new"
dump "$work/after_apply.rb"
echo "::endgroup::"

echo "::group::2/3 PARITY (advisory)"
if diff -u <(normalize db/schema.rb) <(normalize "$work/after_apply.rb"); then
  echo "committed db/schema.rb matches the migrated prod copy"
else
  echo "NOTE (advisory): committed db/schema.rb differs from the migrated prod copy (diff above)."
fi
echo "::endgroup::"

echo "::group::3/3 RE-RUN -- converge after a partial apply"
if [ ! -s "$work/new" ]; then
  echo "no new migrations in this RC; nothing to re-run"
else
  list="$(paste -sd, "$work/new")"
  # shellcheck disable=SC2016  # Ruby interpolation, not shell
  rails runner 'c = ActiveRecord::Base.connection
    vs = ARGV[0].split(",").map { |v| c.quote(Integer(v, 10).to_s) }
    c.execute("DELETE FROM schema_migrations WHERE version IN (#{vs.join(",")})")' "$list"
  if ! rails db:migrate:with_data; then
    echo "MIGRATION REHEARSAL FAILED: re-applying the RC's migrations over their own DDL failed (not idempotent)." >&2
    exit 1
  fi
  dump "$work/after_rerun.rb"
  if ! diff -u <(normalize "$work/after_apply.rb") <(normalize "$work/after_rerun.rb"); then
    echo "MIGRATION REHEARSAL FAILED: re-running the migrations produced a different schema." >&2
    exit 1
  fi
  echo "migrations converge when re-applied"
fi
echo "::endgroup::"
echo "migration rehearsal passed"

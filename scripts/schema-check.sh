#!/usr/bin/env bash
# Reproduce the CI "migration · schema smoke test" job against a local cluster.
#
#   scripts/schema-check.sh
#
# It builds a throwaway database from nothing on every run, so a migration that
# only works when applied on top of yesterday's database fails here the same way
# it fails in CI. Point it at any cluster with PGHOST/PGPORT/PGUSER.
#
# It applies the same shim CI does — supabase/tests/000_supabase_shim.sql — so
# the two cannot drift into disagreeing about what Supabase provides.
set -euo pipefail

cd "$(dirname "$0")/.."

DB="${SCHEMA_CHECK_DB:-ap_emp_ai_schema_check}"
# Defaults target the Supabase local stack (`pnpm db:start`), which is what a
# development PC actually has. They were previously a bare cluster on a /tmp
# socket — the sandbox this repo was first built in — which no normal machine
# runs. CI is unaffected either way: the workflow sets all of these explicitly.
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-54322}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

psql -q -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists $DB;" -c "create database $DB;"
export PGDATABASE="$DB"

printf '── supabase/tests/000_supabase_shim.sql\n'
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/000_supabase_shim.sql

for f in supabase/migrations/*.sql; do
  printf '── %s\n' "$f"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done

printf '\n── supabase/tests/001_schema_smoke.sql\n'
psql -v ON_ERROR_STOP=1 -f supabase/tests/001_schema_smoke.sql

printf '\n✓ schema smoke test passed\n'

#!/usr/bin/env bash
# Runs scripts/setup-local.mjs end to end against a stand-in CLI.
#
#   ./scripts/test-setup-local.sh
#
# Three attempts at reading the local stack's keys were verified at the parser
# and never by running the script. Each passed its tests and failed on a real
# machine. This runs the actual script, through the actual pnpm exec path, and
# checks the file it produces — which is the thing that was never checked.
#
# It shadows node_modules/.bin/supabase for the duration and always restores it,
# including on failure.
set -euo pipefail

cd "$(dirname "$0")/.."

BIN="node_modules/.bin/supabase"
BACKUP="$(mktemp)"
HAD_REAL=0
[ -f "$BIN" ] && { cp "$BIN" "$BACKUP"; HAD_REAL=1; }

# .env is the owner's real file when this is run on a working machine.
ENV_BACKUP="$(mktemp)"
HAD_ENV=0
[ -f .env ] && { cp .env "$ENV_BACKUP"; HAD_ENV=1; }

restore() {
  if [ "$HAD_REAL" -eq 1 ]; then cp "$BACKUP" "$BIN"; chmod +x "$BIN"; else rm -f "$BIN"; fi
  if [ "$HAD_ENV" -eq 1 ]; then cp "$ENV_BACKUP" .env; else rm -f .env; fi
  rm -f "$BACKUP" "$ENV_BACKUP"
}
trap restore EXIT

mkdir -p "$(dirname "$BIN")"
cp scripts/test-support/fake-supabase-cli.mjs "$BIN"
chmod +x "$BIN"

fail=0

# set -e would abort the whole file the moment a run exits non-zero, so a
# regression reports as "no output at all" instead of a named failure. Every
# run goes through this.
run() {
  set +e
  STUB_MODE="$1" STUB_PORT="${STUB_PORT:-54321}" node scripts/setup-local.mjs >"$2" 2>&1
  RUN_CODE=$?
  set -e
}

check() {
  if [ "$2" = "$3" ]; then
    printf '  ✓ %s\n' "$1"
  else
    printf '  ✗ %s — expected %s, got %s\n' "$1" "$3" "$2"
    fail=1
  fi
}

printf '\n1. modern CLI (--output env)\n'
rm -f .env
run modern /tmp/setup-local-1.log
check "exits 0" "$RUN_CODE" "0"
check "writes the API url" \
  "$(grep -c '^NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321$' .env || true)" "1"
check "writes the publishable key" \
  "$(grep -c '^NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_STUBSTUBSTUB$' .env || true)" "1"
check "writes the secret key" \
  "$(grep -c '^SUPABASE_SERVICE_ROLE_KEY=sb_secret_STUBSTUBSTUB$' .env || true)" "1"
check "generates an admin token" "$(grep -cE '^ADMIN_TOKEN=.{20,}$' .env || true)" "1"
# The status block is printed by `start`; printing it again buries the result.
check "does not reprint the status tables" "$(grep -c 'Project URL' /tmp/setup-local-1.log || true)" "0"

printf '\n2. older CLI (falls back to the coloured table)\n'
rm -f .env
run old /tmp/setup-local-2.log
check "exits 0" "$RUN_CODE" "0"
check "still finds the keys" \
  "$(grep -c '^SUPABASE_SERVICE_ROLE_KEY=sb_secret_STUBSTUBSTUB$' .env || true)" "1"
check "never takes a colour code into a value" \
  "$(grep -c '\[1m' .env || true)" "0"

printf '\n3. Docker Desktop not running\n'
rm -f .env
run nodocker /tmp/setup-local-3.log
check "exits non-zero" "$([ "$RUN_CODE" -ne 0 ] && echo yes || echo no)" "yes"
# Presence, not a count: the message names Docker Desktop twice on purpose,
# and pinning the count makes rewording the help text fail the test.
check "names Docker Desktop" \
  "$(grep -q 'Docker Desktop' /tmp/setup-local-3.log && echo yes || echo no)" "yes"
check "writes no .env" "$([ -f .env ] && echo yes || echo no)" "no"

printf '\n4. a .env copied from the template gets its blanks filled\n'
# This is what `copy .env.example .env` leaves: the file exists, the URL still
# holds the template default and both keys are empty. It used to be reported as
# already configured, so the site stayed broken with no sign why.
cp .env.example .env
run modern /tmp/setup-local-4.log
check "exits 0" "$RUN_CODE" "0"
check "fills the publishable key" \
  "$(grep -c '^NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_STUBSTUBSTUB$' .env || true)" "1"
check "fills the secret key" \
  "$(grep -c '^SUPABASE_SERVICE_ROLE_KEY=sb_secret_STUBSTUBSTUB$' .env || true)" "1"
check "generates an admin token" "$(grep -cE '^ADMIN_TOKEN=.{20,}$' .env || true)" "1"
check "keeps the rest of the template" \
  "$(grep -c '^EMBEDDING_DIMENSIONS=1024$' .env || true)" "1"

# The template's own URL default and the stack's URL are normally identical, so
# a run at the default port cannot tell "still the template default" from
# "already configured". A different port can.
rm -f .env
cp .env.example .env
STUB_PORT=54399 run modern /tmp/setup-local-4b.log
check "refreshes a URL still holding the template default" \
  "$(grep -c '^NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399$' .env || true)" "1"

printf '\n5. a configured cloud .env is never overwritten\n'
# Replacing a cloud key with a local one would point the site at the wrong
# database, and nothing on screen would say so.
{
  echo 'NEXT_PUBLIC_SUPABASE_URL=https://real-project.supabase.co'
  echo 'NEXT_PUBLIC_SUPABASE_ANON_KEY=cloud-anon-key'
  echo 'SUPABASE_SERVICE_ROLE_KEY=cloud-service-key'
  echo 'ADMIN_TOKEN=my-existing-admin-token'
} > .env
run modern /tmp/setup-local-5.log
check "keeps the cloud url" \
  "$(grep -c '^NEXT_PUBLIC_SUPABASE_URL=https://real-project.supabase.co$' .env || true)" "1"
check "keeps the cloud key" "$(grep -c '^NEXT_PUBLIC_SUPABASE_ANON_KEY=cloud-anon-key$' .env || true)" "1"
check "keeps the admin token" "$(grep -c '^ADMIN_TOKEN=my-existing-admin-token$' .env || true)" "1"
check "says nothing needed changing" \
  "$(grep -q 'nothing to change' /tmp/setup-local-5.log && echo yes || echo no)" "yes"

printf '\n'
if [ "$fail" -ne 0 ]; then
  printf '✗ setup:local is broken\n'
  exit 1
fi
printf '✓ setup:local works on every path\n'

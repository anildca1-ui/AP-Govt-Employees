#!/usr/bin/env bash
# The definition-of-done gate (CLAUDE.md rule 8), as one command that actually
# fails when something fails.
#
#   ./scripts/gate.sh
#
# Written because piping each step into `grep ... || echo OK` swallows the exit
# code: a type error scrolled past as "OK" and reached a commit. Every step here
# is checked on its status, and the first failure stops the run.
set -euo pipefail

cd "$(dirname "$0")/.."

export NEXT_TELEMETRY_DISABLED=1

step() {
  printf '\n=== %s ===\n' "$1"
  shift
  if "$@"; then
    printf '✓ ok\n'
  else
    printf '✗ FAILED: %s\n' "$1"
    exit 1
  fi
}

# First, because it is the cheapest and the most expensive to get wrong: if the
# rates JSON and the seed migration disagree, the figure the calculator shows a
# user and the figure the database holds are different numbers.
step "rates seed" node scripts/generate-rates-seed.mjs --check
# A stale bundle would build yesterday's schema for anyone following SETUP.md,
# with no sign that it had.
step "db bundle"  node scripts/bundle-migrations.mjs --check
# Runs setup-local.mjs itself against a stand-in CLI. Its parser was unit
# tested three times and shipped broken three times; only running the script
# catches that.
step "setup:local" ./scripts/test-setup-local.sh
step "lint"      pnpm lint
step "typecheck" pnpm typecheck
step "test"      pnpm test
step "build"     pnpm build

printf '\nall gates passed\n'

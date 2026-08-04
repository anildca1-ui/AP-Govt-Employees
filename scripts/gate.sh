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

step "lint"      pnpm lint
step "typecheck" pnpm typecheck
step "test"      pnpm test
step "build"     pnpm build

printf '\nall gates passed\n'

#!/usr/bin/env bash
# Every browser-level guard, as one command for a development PC.
#
#   ./scripts/verify-all.sh
#
# Builds the site, starts it on a spare port, waits until it answers, runs the
# four verification suites against it, and always stops the server — including
# on failure, so a red run never leaves a stray process holding the port.
#
# Each suite was written after a real defect and is mutation-tested:
#   verify:footer       the "not an official website" banner on all 28 routes
#   verify:launch       the pre-launch legal checklist (PLAN.md Part 5, item 4)
#   verify:calculators  results reconcile, shares match the page, print states
#                       its inputs, prefill survives the language toggle
#   verify:mobile       360px: no sideways scroll, 24px tap targets, weight
#
# First run on a new machine: pnpm exec playwright install chromium
# (the sandbox this repo was built in had a preinstalled browser at
# CHROMIUM_PATH; a normal PC lets Playwright manage its own).
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${VERIFY_PORT:-3311}"
BASE="http://127.0.0.1:${PORT}"

echo "── build"
pnpm build

echo "── start on :${PORT}"
(cd apps/web && npx next start -p "$PORT" >/tmp/verify-all-server.log 2>&1) &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "$BASE/te"; then break; fi
  sleep 1
done
curl -sf -o /dev/null "$BASE/te" || {
  echo "server never came up — /tmp/verify-all-server.log:" >&2
  tail -20 /tmp/verify-all-server.log >&2
  exit 1
}

failed=0
for suite in verify:footer verify:launch verify:calculators verify:mobile; do
  echo
  echo "── $suite"
  if ! pnpm "$suite" "$BASE"; then
    failed=1
    echo "✗ $suite FAILED" >&2
    # Keep going: one report covering everything beats stopping at the first.
  fi
done

echo
if [ "$failed" -ne 0 ]; then
  echo "✗ verification failed — see above"
  exit 1
fi
echo "✓ all browser-level guards passed"

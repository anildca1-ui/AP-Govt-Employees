#!/usr/bin/env bash
# loop.sh — run N iterations of the task loop (PLAN.md Part 5.4 / CLAUDE.md Workflow).
#
#   ./loop.sh        # 10 iterations
#   ./loop.sh 3      # 3 iterations
#
# Each iteration executes exactly ONE unchecked task from TASKS.md, then commits.
# Guardrails for unattended mode: run inside a devcontainer/VM, review `git log`
# and PROGRESS.md between batches, and keep Supabase service keys scoped to the
# dev project.
#
# Note: the loop stops early by grepping PROGRESS.md, so the prompt below tells
# the agent to APPEND "ALL-DONE" to PROGRESS.md rather than only printing it —
# a printed line to stdout would never be seen by the grep and the loop would
# keep spending iterations after the work was finished.
set -uo pipefail

iterations="${1:-10}"

for i in $(seq 1 "$iterations"); do
  echo "── loop iteration $i/$iterations ──────────────────────────────────────"

  claude -p "Read CLAUDE.md and TASKS.md. Execute exactly ONE next unchecked task per the Workflow rules. If all tasks in the current phase are done, announce the phase completion and start the next phase's first task. If every task in every phase is done, append the line ALL-DONE to PROGRESS.md and exit." \
    --allowedTools "Edit,Write,Bash,Read" || break

  if grep -q "ALL-DONE" PROGRESS.md 2>/dev/null; then
    echo "ALL-DONE found in PROGRESS.md — stopping after $i iteration(s)."
    break
  fi
done

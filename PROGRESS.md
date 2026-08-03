# PROGRESS.md

Append a 3-line summary after every completed task (see CLAUDE.md → Workflow).

---

## 2026-08-03 — Bootstrap
- Created CLAUDE.md (constitution), PLAN.md (Parts 1–7 spec), TASKS.md (Phases 0–6).
- No code yet; Phase 0 has not started.
- Next: TASKS.md → Phase 0 → first unchecked task (pnpm monorepo scaffold).

## 2026-08-03 — Phase 0.1 pnpm monorepo scaffold
- pnpm workspace with apps/web (Next 15.5.22 + React 19 + Tailwind 4), packages/calc, packages/ingest, packages/rag, supabase/migrations; root vitest runs all packages.
- Each package seeded with one spec-traceable primitive + tests: rupee rounding (Part 4), sha256 dedupe (rule 3), GO-number short-circuit regex (Part 2) — 16 tests green; `pnpm build` and `pnpm typecheck` pass from a clean tree.
- Next: Phase 0 task 2 — Supabase local + migration 001 (PLAN.md Part 3), pgvector HNSW + tsvector GIN indexes.

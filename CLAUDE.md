# CLAUDE.md — ap-emp-ai

## Mission
Telugu-first portal + RAG chatbot + calculators for AP government employees.
Quality bar: every AI answer cites a GO; every calculator has unit tests; Telugu UI everywhere.

## Stack (do not deviate without updating PLAN.md)
Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui · Supabase (Postgres/pgvector/Storage/Auth)
· Embeddings: text-embedding-3-large (env-switchable to BGE-M3) · LLM: Gemini 2.5 Flash (env-switchable)
· Playwright scrapers in packages/ingest · grammY (Telegram) · WhatsApp Cloud API · Vitest.

## Hard rules
1. NEVER hardcode a pay/DA/tax rate in a component — rates come from the `rates` table / `config/rates/*.json` with a `source_go` reference.
2. RAG answers: retrieval-grounded only; must cite GO no+date+link; must respect `superseded_by`; must append the bilingual disclaimer.
3. Scrapers: 1 request per 2s, nightly cron, custom User-Agent `"ap-emp-ai-bot (contact: <contact-email>)"`, obey robots.txt, download official PDFs only, store sha256, skip duplicates.
4. No unofficial WhatsApp libraries. Cloud API only.
5. All user-facing strings in i18n files (`te.json` default, `en.json`).
6. Every ingested document lands in `ingest_queue` → admin approval before it enters RAG.
7. Secrets in `.env` only; never committed. DPDP: log consent, provide `/privacy` in Telugu+English, build delete-my-data endpoint.
8. Definition of done for ANY task: code + tests pass (`pnpm test`) + `pnpm build` succeeds + TASKS.md updated + PROGRESS.md appended + committed with conventional message.

## Workflow (the loop)
On every "continue" instruction: read TASKS.md → pick the FIRST unchecked task in the CURRENT phase →
think, implement, test → if blocked >2 attempts, write the blocker under `## BLOCKED` in TASKS.md with what you tried, and move to next task →
update TASKS.md (`[x]`) → append 3-line summary to PROGRESS.md → commit → report in ≤5 lines → stop and wait.
Never skip phases. Never mark a task done with failing tests.

## Non-negotiable quality rules (apply to every AI-facing feature)
1. Every AI answer MUST cite GO number + date + source PDF link, or say "not found in corpus — verify on goir.ap.gov.in".
2. Never answer from model memory about AP rules. Retrieval-only.
3. Supersession check: if a retrieved GO has a `superseded_by` link, the answer must use the superseding GO and say so.
4. Per-answer disclaimer (Telugu + English): *"ఇది AI సమాచారం మాత్రమే — అధికారిక GO తో సరిచూసుకోండి / AI-generated information only — verify with the original GO before acting."*
5. Telugu UI first, English toggle. All calculators work offline-ish (client-side math).

## Pointers
- Product spec, architecture, DB schema, calculator formulas → `PLAN.md`
- Phase-ordered task list (the loop's fuel) → `TASKS.md`
- Running build log → `PROGRESS.md`

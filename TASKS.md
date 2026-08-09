# TASKS.md

## Phase 0 — Scaffold
- [x] pnpm monorepo: apps/web (Next.js 15), packages/calc, packages/ingest, packages/rag, supabase/
- [x] Supabase local + migration 001 (schema from PLAN.md Part 3), pgvector + tsvector indexes
- [x] Env plumbing (.env.example), CI: GitHub Action running lint+test+build
- [x] Base layout: Telugu/English toggle, nav, PWA manifest, mobile-first

## Phase 1 — Ingestion core
- [x] Playwright scraper: goir.ap.gov.in — list+download last 30 days GOs → ingest_queue (politeness rules)
      ⚠️ selectors in packages/ingest/src/goir/selectors.ts are unverified against the live site
      (no network access from the dev sandbox) — run `pnpm --filter @ap-emp-ai/ingest verify:selectors`
      once, with SCRAPER_CONTACT_EMAIL set, before the first real crawl
- [x] PDF pipeline: pdf-parse text extraction; scanned-detection; OCR fallback interface (stub Surya; vision-LLM fallback via Gemini)
- [x] Metadata extractor: vision-LLM prompt → {go_number, go_type, dept, date, subject, subject_te, supersedes[]} with confidence; low-confidence → flag for review
- [x] Dedupe by sha256; chunker (by section, header metadata attached); embedder; writer to chunks
      (the four stages were built and tested separately but never joined — nothing turned an
      approved GO into chunks, so the chat could never find one. Joined in
      packages/ingest/src/pipeline/index-document.ts, run in bulk by `index:documents`
      and nightly by the ingest workflow)
- [x] Admin review queue UI (/admin): approve/edit/reject, supersession linker
- [x] Nightly cron (Vercel cron or GH Action) for scraper A; scraper B (e-Gazette) + C (Finance circulars)
- [x] Sitemap/RSS diff watcher for the 6 reference sites → discovery list → fetch official PDF

## Phase 2 — RAG chat
- [x] Hybrid search fn: GO-number regex short-circuit → else 0.6 vector + 0.4 tsvector, top-12, rerank to 5
- [x] /api/chat: streaming, system prompt enforcing citation+supersession+disclaimer+Telugu-if-asked-in-Telugu
- [x] /chat UI: streaming bubbles, citation cards (GO no, date, PDF link), feedback 👍👎 → chat_logs
- [x] Eval harness: 30 golden Q&A pairs (Telugu+English) in tests/golden.jsonl; script scores citation-presence & groundedness; fails CI if <90% cite rate

## Phase 3 — Calculators
- [x] rates table seed: current DA %, HRA slabs, RPS-2022 master scale, NPS %, IT slabs (generated from config/rates/rps-2022.json by `pnpm rates:generate`; `--check` guards drift in CI. 0/16 rows verified against a GO — see `pnpm rates:worksheet`)
- [x] packages/calc: 13 pure functions per PLAN.md Part 4, each with Vitest worked-example tests
- [x] 13 calculator pages: shadcn forms, Telugu labels, WhatsApp-share, print/PDF
- [x] /calculators index with search

## Phase 4 — Bots
- [x] Telegram bot (grammY): /ask (RAG), /da (calculator), receives PDFs → ingest_queue; deploy webhook
- [x] Telegram channel monitor (read-only) → ingest_queue
- [x] WhatsApp Cloud API webhook: text → RAG answer; media (PDF) → ingest_queue with thank-you reply

## Phase 5 — Content modules
- [x] /gos library: filters, infinite scroll, supersession chain visual, per-GO page with AI summary (Telugu)
- [x] /news: auto-summaries of newly approved documents, tagged (DA/PRC/Transfers/EHS/Exams)
- [x] /tests hub: EOT-141, GOT-88/97 syllabus pages + AI quiz generator from corpus (20 MCQs, cite source GO/rule per question)
- [x] /links directory (categorized, with uptime ping badge)

## Phase 6 — Users & polish
- [x] Supabase auth (phone OTP), profile (basic pay, scale, dept, CPS/OPS), consent logging, delete-my-data
- [x] Personal dashboard: prefilled calculators; "DA change impact" card
- [x] SEO: per-GO metadata, sitemap, Telugu OG images; Lighthouse ≥90 mobile
      (OG images: site name is text-based per-page metadata; dedicated Telugu OG image generation
      and a Lighthouse run need a deployed site — measure after first deploy)
- [x] /privacy + /disclaimer pages (Telugu+English), rate limiting, error tracking
      (error tracking: Sentry wired and inert without a DSN — set NEXT_PUBLIC_SENTRY_DSN to
      enable, and SENTRY_ORG/PROJECT/AUTH_TOKEN at deploy time for readable stack traces.
      Personal data is stripped before any report is sent; /privacy discloses the service)

## Launch readiness — verified 2026-08-07

The production build was started with an empty environment (no Supabase, no
model key) and every page walked in a browser. What that established:

- **Ready now, no accounts needed.** All 13 calculators load and compute
  client-side. /links, /tests syllabus, /privacy, /disclaimer render fully.
  /gos and /news degrade honestly ("database not connected yet", "no news
  yet") rather than erroring. So the calculator half of the site can go live
  on Vercel before any account exists.
- **Needs the owner's accounts.** Chat, the GO library, news, quiz, sign-in
  and the dashboard all need a Supabase project; chat and quiz additionally
  need a Gemini key. Nothing here is unbuilt — it is unconfigured. See
  SETUP.md, and `pnpm setup:check` reports what is missing.
- **Pre-launch legal checklist — passing.** PLAN.md Part 5 checkpoint 4 runs
  as `pnpm verify:launch <url>`: disclaimer and privacy pages live and
  substantive in both locales, DPDP consent recorded with its policy version
  and deletion behind a typed confirmation, no page contacting any host but
  its own, and the "not an official Government of AP website" banner on all
  28 routes including 404s. Mutation-tested — an injected ad tag, a dropped
  consent box and an unguarded delete each fail it.
- **Needs a person, not a key.** 0 of 16 rates are verified against a GO
  (`pnpm rates:worksheet`). Every unverified rate shows a warning on the
  page, so nothing presents itself as authoritative — but the figures are
  from public summaries, not from the orders. This is the last thing between
  the site and being trustworthy, and it needs someone accountable for the
  number.

## BLOCKED

- **Which intermediate a payout GO rounds is unconfirmed.** DA arrears are
  computed from rounded pay-bill lines, because DA appears on a bill as whole
  rupees. Gratuity and leave encashment instead compute from *exact* monthly
  emoluments and round once at the end. Both are defensible and they differ by
  a few rupees on a lakh; only the governing GO settles which is right.
  *Not guessed:* rule 2 forbids answering AP rules from memory, so the display
  was made honest (the page now shows the exact emoluments it computes from,
  so what is on screen multiplies back to the total) without touching any
  payout. Whoever verifies the rates should settle this at the same time.

- **AAS 6-12-18-24 scheme not encoded** (PLAN.md Part 4, calculator 3). The FR
  22-B fixation *mechanism* is built and tested — notional increment, then fix
  at the next stage of the promotion scale, never below its floor. What is
  missing is the scheme itself: which service lengths entitle an employee to
  SG / SPP-I / SAPP-I / SPP-II, and the scale each carries. The calculator
  therefore only serves someone who already knows their promotion scale's
  minimum — the very thing they came to find out.
  *What I tried:* looked for the thresholds in the corpus (empty), in
  `config/` (absent), and in the calc package (only the mechanism).
  *Why I stopped rather than filling them in:* CLAUDE.md rule 1 forbids a rate
  with no `source_go`, and rule 2 forbids answering about AP rules from model
  memory. Inventing plausible service lengths would be exactly the failure the
  rules exist to prevent. Needs the governing GO ingested, or the figures from
  someone accountable for them.

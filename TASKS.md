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
- [x] Admin review queue UI (/admin): approve/edit/reject, supersession linker
- [x] Nightly cron (Vercel cron or GH Action) for scraper A; scraper B (e-Gazette) + C (Finance circulars)
- [x] Sitemap/RSS diff watcher for the 6 reference sites → discovery list → fetch official PDF

## Phase 2 — RAG chat
- [x] Hybrid search fn: GO-number regex short-circuit → else 0.6 vector + 0.4 tsvector, top-12, rerank to 5
- [x] /api/chat: streaming, system prompt enforcing citation+supersession+disclaimer+Telugu-if-asked-in-Telugu
- [x] /chat UI: streaming bubbles, citation cards (GO no, date, PDF link), feedback 👍👎 → chat_logs
- [x] Eval harness: 30 golden Q&A pairs (Telugu+English) in tests/golden.jsonl; script scores citation-presence & groundedness; fails CI if <90% cite rate

## Phase 3 — Calculators
- [x] rates table seed: current DA %, HRA slabs, RPS-2022 master scale, NPS %, IT slabs (each row with source_go placeholder for me to verify)
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

## BLOCKED
(none yet)

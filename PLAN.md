# PLAN.md — AP Government Employees Super-Portal (`ap-emp-ai`)

**Goal:** One portal that supersedes apemp.in, revenueacademy.in, apgea.org, apteachers.in, amaravathiteacher.com, gunturbadi.in — with automated GO ingestion, a Telugu+English RAG chatbot, and a full calculator suite.

This document is the durable product spec. `TASKS.md` is the execution queue; `CLAUDE.md` is the operating constitution. Part numbering below is referenced from TASKS.md — do not renumber.

---

## PART 1 — WHAT TO BUILD (Product Spec)

### 1.1 Feature superset (derived from the 6 reference sites + gaps none of them fill)

| Module | What it does | Beats existing sites because |
|---|---|---|
| **GO Library** | Every AP GO/Memo/Circular, full-text searchable, filterable by dept/date/type/topic, with supersession chains ("this GO amended by → superseded by →") | apemp.in has no search or supersession tracking |
| **AI Chat (RAG)** | Telugu + English Q&A grounded ONLY in the GO corpus, every answer cites GO No. + date + PDF link | No existing site has this at all |
| **Calculator Suite** | DA arrears, pay fixation, increment, NPS/CPS, GPS pension, gratuity, leave encashment, surrender leave, AAS 6/12/18/24, APGLI, GPF, income tax (old/new regime), retirement countdown | Existing sites host scattered Excel files (KSS Prasad style); ours are live, mobile-first, shareable |
| **News Feed** | Auto-aggregated employee news (DA announcements, PRC, transfers, EHS updates) from monitored sources, AI-summarized in Telugu | apemp/apteachers do this manually and slowly |
| **Departmental Tests Hub** | EOT 141, GOT 88/97, Special Language Test syllabus + notes + AI-generated practice quizzes from the corpus | revenueacademy/gunturbadi have static PDFs only |
| **Quick Links Directory** | Curated links: CFMS, HRMS, EHS, PGRS, e-Gazette, APGLI, GPF, IFMIS, ZPPF, SCERT, CSE, DIKSHA, Treasury (apgea.org's links page, but categorized + status-checked) | apgea's list is a flat, stale page |
| **Personal Dashboard** (Phase 2) | Save my basic pay/scale → all calculators pre-filled, "what changes for ME when DA is announced" push alerts | Nobody does personalization |
| **WhatsApp/Telegram Bot** | Same RAG chat + calculators via chat commands | Nobody has this |

### 1.2 Non-negotiable quality rules (bake into every prompt)
1. Every AI answer MUST cite GO number + date + source PDF link, or say "not found in corpus — verify on goir.ap.gov.in".
2. Never answer from model memory about AP rules. Retrieval-only.
3. Supersession check: if a retrieved GO has a `superseded_by` link, the answer must use the superseding GO and say so.
4. Per-answer disclaimer (Telugu + English): *"ఇది AI సమాచారం మాత్రమే — అధికారిక GO తో సరిచూసుకోండి / AI-generated information only — verify with the original GO before acting."*
5. Telugu UI first, English toggle. All calculators work offline-ish (client-side math).

---

## PART 2 — ARCHITECTURE & STACK

```
┌─────────────────────────────────────────────────────────┐
│ INGESTION (runs on cron, fully automatic)                │
│  ├─ Scraper A: goir.ap.gov.in (GO index, daily)          │
│  ├─ Scraper B: apegazette.cgg.gov.in (e-Gazette, daily)  │
│  ├─ Scraper C: apfinance.gov.in circulars (daily)        │
│  ├─ Scraper D: sitemap/RSS diff on the 6 reference sites │
│  ├─ Telegram ingester: bot + channel monitor             │
│  └─ WhatsApp ingester: "forward a GO to our bot" inbox   │
│         ↓ dedupe (SHA-256) ↓                             │
│  PDF pipeline: text-extract → (if scanned) OCR →         │
│  vision-LLM metadata extraction (GO No, date, dept,      │
│  subject, supersedes?) → chunk → embed → pgvector        │
│         ↓                                                │
│  Admin review queue (approve / fix metadata / reject)    │
├─────────────────────────────────────────────────────────┤
│ STORAGE: Supabase (Postgres + pgvector + Storage + Auth) │
├─────────────────────────────────────────────────────────┤
│ APP: Next.js 15 (App Router) on Vercel                   │
│  ├─ /chat (RAG, streaming, Telugu/English)               │
│  ├─ /gos (library + filters + supersession graph)        │
│  ├─ /calculators/* (client-side tools, see Part 4)       │
│  ├─ /news, /tests, /links, /dashboard, /admin            │
│  └─ /api/* (chat, search, ingest webhooks, bot webhooks) │
├─────────────────────────────────────────────────────────┤
│ AI: embeddings = BGE-M3 (via DeepInfra/self-host) OR     │
│     OpenAI text-embedding-3-large (simpler start)        │
│     answer LLM = Gemini 2.5 Flash (Telugu, cheap) —      │
│     configurable via env: LLM_PROVIDER / MODEL           │
│     OCR = pdf-text first → Surya OCR → vision-LLM fallback│
├─────────────────────────────────────────────────────────┤
│ BOTS: Telegram Bot API (grammY) · WhatsApp Cloud API     │
│ CRON: Vercel Cron / GitHub Actions (scrapers nightly)    │
└─────────────────────────────────────────────────────────┘
```

**Key decisions to follow:**
- Monorepo, TypeScript everywhere. Python allowed ONLY inside `packages/ocr-worker` if Surya is used (runs as a separate service/GitHub Action).
- pgvector with HNSW index + Postgres full-text (tsvector) for hybrid search: `score = 0.6*vector + 0.4*keyword`, and an exact-match short-circuit when the query contains a GO number pattern (`G.O.(Ms|Rt).No.\s*\d+`).
- All rates (DA %, HRA slabs, PRC master scale, NPS %, APGLI premia, IT slabs) live in a `rates` table + versioned JSON in `/config/rates/` — NEVER hardcode a rate inside a calculator component. Calculators read the table; updating a DA GO updates every calculator.

### 2.1 Ingestion realism notes (important)
- **goir.ap.gov.in** — the primary source: post-2008 GOs, searchable index. Scraper = Playwright, iterate department × date-range, download PDFs, store `source_url`. Be polite: 1 req/2s, nightly window, User-Agent identifying the project, respect robots.txt. Content is government-work (Copyright Act S.52(1)(q)) — republication is defensible; still always link the official source.
- **Telegram** — fully automatable and ToS-safe if done as: (a) your own bot added as admin to YOUR aggregator channel/group where users post GOs, and (b) monitoring public channels you join. Use Bot API (grammY) for (a); for (b) a Telethon user-session works but keep read-only and rate-limited. Every PDF received → same pipeline → review queue.
- **WhatsApp** — ⚠️ do NOT scrape groups with unofficial libraries (Baileys/whatsapp-web.js) — real ban risk and ToS violation. Instead: official **Cloud API bot** with a published number; users/admins **forward** GO PDFs to the bot ("📤 Forward any GO to this number and we'll add it to the library"). Inbound media within the 24-h service window is free. This turns your audience into the ingestion network — better than scraping.
- **The 6 reference sites** — diff their sitemaps/RSS daily to *discover* new GOs they've posted, then fetch the underlying official PDF (from goir/e-Gazette) rather than copying their pages. Discover via them, source from government.

---

## PART 3 — DATABASE SCHEMA (create as migration 001)

```sql
documents(id, go_number text, go_type text, -- Ms/Rt/Memo/Circular
  dept text, issue_date date, subject text, subject_te text,
  pdf_url text, source text, sha256 text unique,
  language text, is_scanned bool, status text, -- pending/approved/rejected
  supersedes uuid[] , superseded_by uuid, amended_by uuid[],
  created_at, reviewed_by)

chunks(id, document_id fk, seq int, content text, content_te text,
  embedding vector(1024), tsv tsvector, page int)

rates(id, kind text, -- 'DA','HRA','IR','NPS','IT_SLAB','MASTER_SCALE','APGLI'
  effective_from date, effective_to date, payload jsonb, source_go uuid)

chat_logs(id, session, question, answer, cited_docs uuid[],
  lang, channel, -- web/whatsapp/telegram
  feedback int, created_at)

ingest_queue(id, source, raw_url, file_path, sha256, status, error, meta jsonb)

users(id, phone, name, basic_pay int, scale text, dept text,
  join_date date, cps_or_ops text, consents jsonb)  -- DPDP consent log
```

Indexes required by migration 001: HNSW index on `chunks.embedding`, GIN index on `chunks.tsv`, unique index on `documents.sha256`, and lookup indexes on `documents(issue_date)`, `documents(dept)`, `documents(go_number)`.

---

## PART 4 — CALCULATOR SPECS (each = one route + one pure function + tests)

> All formulas read from the `rates` table. Seed the table from published AP Finance Dept GOs during Phase 3; keep a `source_go` link on every rate row so each calculator can display "as per G.O.Ms.No.__ dt.__".

1. **DA Arrears** — input: basic pay, period, old DA%, new DA% (auto-filled from `rates`). `monthly_diff = round(basic × newDA/100) − round(basic × oldDA/100)`; sum over months; split cash vs GPF/CPS credit per the sanctioning GO's terms. Output month-wise table + PDF download.
   > Not `basic × (newDA−oldDA)/100`, which this line used to say. DA appears on a pay bill as a whole-rupee figure, so the arrear is the gap between what the bill should have said and what it did say — both sides rounded before subtracting. The two rules disagree by a rupee a month on about a quarter of the master scale's stages. `da-arrears.test.ts` pins the correct one at basic 21,200, where the shorthand gives 1,543 and the pay bill gives 1,544.
2. **Pay Fixation on Increment** — RPS-2022 master scale stages stored in `rates(MASTER_SCALE)`; increment = move to next stage in the employee's scale; show new basic + new DA/HRA/gross.
3. **Promotion / AAS 6-12-18-24 Fixation** — FR 22(a)(i) / FR 22-B style fixation: notional increment then fix at next stage in promotion scale; AAS = SG/SPP-I/SAPP-I/SPP-II stages. (Encode rules as config, cite the governing GO.)
   > ⚠️ **Partly built.** The FR 22-B *mechanism* is implemented and tested (`calculateFixation`): notional increment, then fix at the next stage of the promotion scale, never below its floor. What is **not** encoded is the AAS scheme itself — which service lengths entitle an employee to SG / SPP-I / SAPP-I / SPP-II, and which scale each carries. So the calculator works only for someone who already knows the promotion scale's minimum, which is the part a user most needs told.
   > Not filled in from memory on purpose: CLAUDE.md rule 1 forbids a rate without a `source_go`, and rule 2 forbids answering about AP rules from model memory. This needs the governing GO in the corpus, or a figure a person is accountable for. Until then the honest position is that the scheme is unencoded, not that it is wrong.
4. **Full Salary Calculator** — basic → DA + HRA (slab by city class from `rates`) + CCA − deductions (GPF/CPS, APGLI, GIS, PT, IT) → net.
5. **NPS/CPS Projector** — monthly contribution = 10% (employee) + 14% (govt) of basic+DA; project corpus to retirement at user-set return %; annuity estimate.
6. **GPS (Guaranteed Pension Scheme) estimator** — 50% of last drawn basic assured-pension model per AP GPS Act; show CPS-vs-GPS comparison. Mark clearly as *estimate*.
7. **OPS Pension & Commutation** (pre-2004 joiners / pensioner visitors) — pension = 50% of last pay (≥ qualifying service); commutation = 40% max × commutation factor table × 12.
8. **Gratuity** — min(16.5 × (basic+DA)/2-month formula per AP rules, ceiling from `rates`).
9. **Leave Encashment & Surrender Leave** — EL balance × (basic+DA)/30; half-pay-leave rules; surrender 15/30 days.
10. **Income Tax (old vs new regime)** — slabs from `rates(IT_SLAB)` per FY; standard deduction, 80C, HRA exemption calc; recommend regime.
11. **APGLI premium/bonus** and **GPF interest** calculators.
12. **Retirement Countdown & Benefits Summary** — DOB + DOJ → retirement date, total service, one-click estimate of gratuity + encashment + pension/GPS + GPF.
13. **Medical Reimbursement eligibility helper** — wizard over AP Medical Attendance Rules 1972 + EHS: answers "claim MR or use EHS?" (RAG-assisted, not pure math).

Each calculator: pure TS function in `packages/calc/src/*.ts` + Vitest unit tests with worked examples + a shadcn/ui form + Telugu labels + "share result on WhatsApp" button + printable PDF.

---

## PART 5 — REVIEW CHECKPOINTS (human intervention required)

1. **After Phase 1:** manually verify 20 random documents in the review queue — is metadata extraction ≥90% correct? Fix the extractor prompt before scaling.
2. **After Phase 2:** run the golden-set eval; ask the bot 10 tricky Telugu service-rule questions by hand. Domain expertise is the real QA.
3. **After Phase 3 seed:** verify every `rates` row against the actual GO (DA GOs, RPS 2022, AAS). Wrong rates = wrong money = credibility death.
4. **Before public launch:** legal checklist — disclaimer pages live, DPDP consent + delete endpoint working, site unmonetized (per the conduct-rules plan), "not an official Govt of AP website" banner in the footer of every page.

---

## PART 6 — BUILD ORDER & TIMELINE (realistic, part-time)

| Weeks | Milestone |
|---|---|
| 1 | Phase 0 + Phase 1 scraper A working; first 500 GOs in queue |
| 2–3 | Full ingestion pipeline + admin queue; 5,000+ approved docs |
| 4 | RAG chat live on web, passing golden-set eval |
| 5–6 | All 13 calculators, rates verified |
| 7 | Telegram + WhatsApp bots |
| 8 | News/tests/links modules, SEO, soft-launch to 2–3 trusted WhatsApp groups |

**Launch wedge:** soft-launch with just **GO search + DA arrears calculator + chat** — those three alone beat every reference site. Everything else compounds after.

---

## PART 7 — OPEN DECISIONS (resolve before the phase that needs them)

All four are now settled in code. The one that still needs a human is the first,
and it is enforced rather than trusted.

- **Contact email for the scraper User-Agent** — ⚠️ **needs a human.** Supplied at runtime as `SCRAPER_CONTACT_EMAIL`, sent as `ap-emp-ai-bot (contact: $SCRAPER_CONTACT_EMAIL)`. `packages/ingest/src/politeness/user-agent.ts` refuses to scrape when it is unset or obviously fake, so the decision cannot be skipped by forgetting it — but no crawl can run until a real, monitored address is set.
- **Calculator count** — ✅ **13**, consistent across Part 4, TASKS.md Phase 3, the 13 route directories and the 13 entries in `apps/web/src/lib/calculators/registry.ts` (item 11 bundles APGLI + GPF). Part 2 now points at Part 4 rather than naming a number, so there is one place to update if APGLI and GPF are ever split.
- **Embedding dimension** — ✅ **1024**, pinned as `EMBEDDING_DIMENSIONS` and matching `chunks.embedding vector(1024)`. The OpenAI provider sends `dimensions: 1024` on every request — mandatory, not an optimisation, since `text-embedding-3-large` is 3072-d natively — and both providers throw on a returned vector of the wrong width rather than letting a mis-sized embedding reach the database. BGE-M3 is 1024-d natively and sends no parameter.
- **Hosting of the OCR worker** — ✅ **deferred by design.** `packages/ingest/src/pdf/ocr/surya.ts` is a typed stub against a future Python worker; Gemini vision is the working fallback meanwhile, and OCR can be switched off entirely. Nothing depends on Surya existing, so the hosting choice can wait until scanned GOs actually justify it.

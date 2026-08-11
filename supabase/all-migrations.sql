-- ═══════════════════════════════════════════════════════════════════════
-- EVERY MIGRATION, IN ORDER — paste this whole file into Supabase's SQL
-- Editor and press Run. Once. That builds the entire database.
--
-- GENERATED FILE — do not edit by hand.
-- Source:     supabase/migrations/*.sql  (6 files)
-- Regenerate: pnpm db:bundle
--
-- Run it ONCE. If you run it again you will see red errors saying things
-- "already exist" — that means the database is already built. Nothing is
-- damaged and nothing is duplicated; the second run simply stops.
-- ═══════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────
-- 20260803000001_initial_schema.sql
-- ───────────────────────────────────────────────────────────────────────

-- Migration 001 — initial schema (PLAN.md Part 3)
--
-- Filename follows the Supabase CLI's YYYYMMDDHHMMSS_name.sql convention; the
-- timestamp is backdated so this always sorts first.
--
-- Tables: documents, chunks, rates, chat_logs, ingest_queue, users.
-- Retrieval indexes: HNSW over chunks.embedding, GIN over chunks.tsv.
--
-- Two rules from CLAUDE.md are enforced here in data rather than left to
-- application code:
--   rule 6 — nothing enters RAG without admin approval: documents.status
--            defaults to 'pending' and the read policies only expose 'approved'.
--   rule 1 — no hardcoded rates: the rates table carries source_go so every
--            calculator can render "as per G.O.Ms.No.__ dt.__".

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- documents — one row per GO / Memo / Circular
-- ---------------------------------------------------------------------------
create table documents (
  id            uuid primary key default gen_random_uuid(),
  go_number     text,
  go_type       text check (go_type in ('Ms', 'Rt', 'Memo', 'Circular')),
  dept          text,
  issue_date    date,
  subject       text,
  subject_te    text,
  pdf_url       text,
  source        text,
  -- Identity is the bytes of the PDF: the same GO arrives from goir, the
  -- e-Gazette, Telegram and WhatsApp forwards.
  sha256        text unique not null,
  language      text,
  is_scanned    boolean not null default false,
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected')),
  supersedes    uuid[] not null default '{}',
  superseded_by uuid references documents (id) on delete set null,
  amended_by    uuid[] not null default '{}',
  created_at    timestamptz not null default now(),
  reviewed_by   uuid,
  -- A GO cannot supersede itself; a self-link would make the supersession walk
  -- in the answer path loop forever.
  constraint documents_superseded_by_not_self check (superseded_by is distinct from id)
);

comment on column documents.supersedes is
  'GOs this document supersedes. Array, so no FK — integrity is enforced in the admin supersession linker.';
comment on column documents.status is
  'pending until an admin approves it in /admin. Only approved documents are retrievable (CLAUDE.md rule 6).';

create index documents_issue_date_idx on documents (issue_date desc);
create index documents_dept_idx on documents (dept);
create index documents_go_number_idx on documents (go_number);
create index documents_status_idx on documents (status);
-- Supports the "what supersedes this GO?" walk in the answer path.
create index documents_superseded_by_idx on documents (superseded_by);

-- ---------------------------------------------------------------------------
-- chunks — embedded, full-text-indexed pieces of an approved document
-- ---------------------------------------------------------------------------
create table chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  seq         integer not null,
  content     text not null,
  content_te  text,
  -- 1024 dimensions: BGE-M3's native size. text-embedding-3-large must be
  -- requested with dimensions=1024 to match (PLAN.md Part 7).
  embedding   vector(1024),
  page        integer,
  -- Generated, so the keyword half of hybrid search can never drift out of sync
  -- with the text. 'simple' rather than 'english': the corpus is bilingual and
  -- Postgres has no Telugu stemmer, so we tokenise without stemming instead of
  -- stemming one language and mangling the other.
  tsv         tsvector generated always as (
                to_tsvector('simple', coalesce(content, '') || ' ' || coalesce(content_te, ''))
              ) stored,
  unique (document_id, seq)
);

-- Vector half of hybrid search. Cosine distance — embeddings are normalised.
create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
-- Keyword half.
create index chunks_tsv_idx on chunks using gin (tsv);
create index chunks_document_id_idx on chunks (document_id);

-- ---------------------------------------------------------------------------
-- rates — every DA %, HRA slab, master scale and IT slab (CLAUDE.md rule 1)
-- ---------------------------------------------------------------------------
create table rates (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null
                   check (kind in ('DA', 'HRA', 'IR', 'NPS', 'IT_SLAB', 'MASTER_SCALE', 'APGLI')),
  effective_from date not null,
  effective_to   date,
  payload        jsonb not null,
  -- Nullable: seeded rows carry a placeholder until the GO is ingested and
  -- verified against the PDF (PLAN.md Part 5 checkpoint 3).
  source_go      uuid references documents (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint rates_period_ordered check (effective_to is null or effective_to >= effective_from)
);

-- "Which DA applied in March 2025?" — the lookup every calculator makes.
create index rates_kind_effective_idx on rates (kind, effective_from desc);

-- ---------------------------------------------------------------------------
-- chat_logs — questions, answers and the citations behind them
-- ---------------------------------------------------------------------------
create table chat_logs (
  id         uuid primary key default gen_random_uuid(),
  session    text,
  question   text not null,
  answer     text,
  cited_docs uuid[] not null default '{}',
  lang       text check (lang in ('te', 'en')),
  channel    text not null default 'web' check (channel in ('web', 'whatsapp', 'telegram')),
  feedback   smallint check (feedback in (-1, 1)),
  created_at timestamptz not null default now()
);

create index chat_logs_created_at_idx on chat_logs (created_at desc);
-- Finds the thumbs-down answers to review, which is the point of collecting them.
create index chat_logs_feedback_idx on chat_logs (feedback) where feedback is not null;

-- ---------------------------------------------------------------------------
-- ingest_queue — everything inbound, before it becomes a document
-- ---------------------------------------------------------------------------
create table ingest_queue (
  id         uuid primary key default gen_random_uuid(),
  source     text not null,
  raw_url    text,
  file_path  text,
  sha256     text,
  status     text not null default 'pending'
               check (status in ('pending', 'processing', 'done', 'failed', 'duplicate')),
  error      text,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index ingest_queue_status_idx on ingest_queue (status);
-- Cheap "have we already fetched this?" check before downloading again.
create index ingest_queue_sha256_idx on ingest_queue (sha256) where sha256 is not null;

-- ---------------------------------------------------------------------------
-- users — employee profile for prefilled calculators + DPDP consent log
-- ---------------------------------------------------------------------------
create table users (
  id          uuid primary key default gen_random_uuid(),
  phone       text unique,
  name        text,
  basic_pay   integer check (basic_pay is null or basic_pay > 0),
  scale       text,
  dept        text,
  join_date   date,
  cps_or_ops  text check (cps_or_ops in ('CPS', 'OPS', 'GPS')),
  consents    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

comment on table users is
  'Employee profile. Phase 6 adds phone-OTP auth and links id to auth.users(id); until then rows are service-role only. consents is the DPDP consent log (CLAUDE.md rule 7).';

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Without this, anything in the public schema is readable by anyone holding the
-- anon key. Default is deny; the service role used by the ingestion pipeline and
-- the admin queue bypasses RLS entirely.
-- ---------------------------------------------------------------------------
alter table documents    enable row level security;
alter table chunks       enable row level security;
alter table rates        enable row level security;
alter table chat_logs    enable row level security;
alter table ingest_queue enable row level security;
alter table users        enable row level security;

-- The GO library is public — but only what an admin has approved.
create policy documents_public_read on documents
  for select to anon, authenticated
  using (status = 'approved');

create policy chunks_public_read on chunks
  for select to anon, authenticated
  using (exists (
    select 1 from documents d
    where d.id = chunks.document_id and d.status = 'approved'
  ));

-- Calculators run client-side and read rates directly.
create policy rates_public_read on rates
  for select to anon, authenticated
  using (true);

-- chat_logs, ingest_queue and users get no anon/authenticated policy on purpose:
-- service role only until Phase 6 introduces auth and per-user ownership.

-- ───────────────────────────────────────────────────────────────────────
-- 20260803000002_ingest_queue_sha256_unique.sql
-- ───────────────────────────────────────────────────────────────────────

-- Migration 002 — make ingest_queue.sha256 unique.
--
-- Migration 001 gave ingest_queue.sha256 a plain index, which makes the
-- "have we seen this PDF?" lookup fast but does not stop a second copy landing.
-- CLAUDE.md rule 3 requires skipping duplicates, and an application-level check
-- alone loses the race: two nightly runs, or a scraper and a WhatsApp forward
-- arriving together, can both read "not present" before either inserts.
--
-- Partial, because sha256 is null until the file has actually been fetched —
-- several rows may legitimately be awaiting download at once.

drop index if exists ingest_queue_sha256_idx;

create unique index ingest_queue_sha256_key
  on ingest_queue (sha256)
  where sha256 is not null;

-- ───────────────────────────────────────────────────────────────────────
-- 20260803000003_watch_seen.sql
-- ───────────────────────────────────────────────────────────────────────

-- Migration 003 — watch_seen, the memory of the reference-site diff watcher.
--
-- PLAN.md Part 2.1: we diff the six reference sites' sitemaps and feeds to
-- DISCOVER that a new GO exists, then fetch the official PDF from goir or the
-- e-Gazette. Discovery is the only thing those sites are used for; their pages
-- are never ingested.
--
-- Without a record of what has already been seen, every nightly run would
-- re-queue the whole sitemap. The primary key is what makes the diff a diff.

create table watch_seen (
  site       text not null,
  url        text not null,
  first_seen timestamptz not null default now(),
  primary key (site, url)
);

comment on table watch_seen is
  'URLs already seen on a reference site''s sitemap/RSS. Discovery bookkeeping only — no document content lives here.';

-- Service-role only: this is crawler bookkeeping, of no use to a visitor, and
-- it names third-party URLs we monitor. RLS on with no anon policy denies by
-- default (the ingestion job uses the service role, which bypasses RLS).
alter table watch_seen enable row level security;

-- ───────────────────────────────────────────────────────────────────────
-- 20260803000004_search_chunks.sql
-- ───────────────────────────────────────────────────────────────────────

-- Migration 004 — hybrid search over the approved corpus (PLAN.md Part 2).
--
-- score = 0.6 * vector + 0.4 * keyword, as the plan specifies.
--
-- The two halves are gathered as separate index-backed subqueries and then
-- fused, rather than computing a blended score across all chunks and sorting.
-- That is not a micro-optimisation: an ORDER BY over an expression involving
-- `<=>` cannot use the HNSW index, so the single-query form degrades into a
-- sequential scan of every chunk with a distance computation on each. Each half
-- here uses its own index (HNSW for vectors, GIN for tsvector) and only the
-- small union is scored.
--
-- Measured on Postgres 16 + pgvector 0.6 while writing this, at 30,000 chunks:
-- this form 24ms, the naive blended sort 192ms. EXPLAIN confirms the difference
-- is index usage — Index Scan using chunks_embedding_idx here versus Seq Scan
-- on chunks there — so the gap widens with the corpus, and the corpus is meant
-- to reach every AP GO since 2008.
--
-- Superseded documents are deliberately NOT filtered out. CLAUDE.md rule 3
-- requires an answer to follow supersession and say that it did, which it can
-- only do if the superseded GO is retrievable and carries its superseded_by
-- link. Filtering here would silently answer from nothing.

create or replace function search_chunks(
  query_embedding vector(1024),
  query_text text,
  match_count integer default 12,
  vector_weight real default 0.6,
  keyword_weight real default 0.4
)
returns table (
  chunk_id uuid,
  document_id uuid,
  seq integer,
  content text,
  page integer,
  go_number text,
  go_type text,
  dept text,
  issue_date date,
  subject text,
  subject_te text,
  pdf_url text,
  superseded_by uuid,
  vector_score real,
  keyword_score real,
  score real
)
language sql
stable
as $$
  with q as (
    select websearch_to_tsquery('simple', coalesce(query_text, '')) as tsq
  ),
  -- Over-fetch each half: a chunk ranked 20th by vector may be 2nd by keyword,
  -- and fusing only the top-12 of each would lose it before scoring.
  vector_hits as (
    select c.id, (1 - (c.embedding <=> query_embedding))::real as vscore
    from chunks c
    join documents d on d.id = c.document_id
    where d.status = 'approved'
      and query_embedding is not null
      and c.embedding is not null
    order by c.embedding <=> query_embedding
    limit match_count * 3
  ),
  keyword_hits as (
    select c.id, ts_rank_cd(c.tsv, (select tsq from q), 32)::real as kscore
    from chunks c
    join documents d on d.id = c.document_id
    where d.status = 'approved'
      and (select tsq from q) is not null
      and c.tsv @@ (select tsq from q)
    -- Normalisation flag 32 divides by (rank + 1), bounding the result to 0..1
    -- so it is commensurable with cosine similarity. Without it the raw rank is
    -- unbounded and the keyword half would dominate any weighting.
    order by ts_rank_cd(c.tsv, (select tsq from q), 32) desc
    limit match_count * 3
  ),
  fused as (
    select
      coalesce(v.id, k.id) as id,
      coalesce(v.vscore, 0::real) as vector_score,
      coalesce(k.kscore, 0::real) as keyword_score
    from vector_hits v
    full outer join keyword_hits k on k.id = v.id
  )
  select
    c.id,
    c.document_id,
    c.seq,
    c.content,
    c.page,
    d.go_number,
    d.go_type,
    d.dept,
    d.issue_date,
    d.subject,
    d.subject_te,
    d.pdf_url,
    d.superseded_by,
    f.vector_score,
    f.keyword_score,
    (vector_weight * f.vector_score + keyword_weight * f.keyword_score)::real as score
  from fused f
  join chunks c on c.id = f.id
  join documents d on d.id = c.document_id
  order by score desc, c.document_id, c.seq
  limit match_count;
$$;

comment on function search_chunks is
  'Hybrid retrieval: 0.6*cosine + 0.4*normalised ts_rank over approved documents only. Superseded documents are returned with their superseded_by link so the answer path can follow it (CLAUDE.md rule 3).';

-- Callable by the anon key: retrieval is public, and the function only ever
-- reads approved documents. It is security invoker, so RLS still applies to the
-- underlying tables.
grant execute on function search_chunks(vector, text, integer, real, real) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Exact-GO lookup, the short-circuit half of retrieval.
--
-- When a user types a GO number they want that order, not the twelve documents
-- nearest it in embedding space. Ordering by seq (not by score) matters here:
-- the caller is reading one document in its own order, not ranked fragments.
-- ---------------------------------------------------------------------------
create or replace function chunks_for_go_number(
  go_number_query text,
  match_count integer default 12
)
returns table (
  chunk_id uuid,
  document_id uuid,
  seq integer,
  content text,
  page integer,
  go_number text,
  go_type text,
  dept text,
  issue_date date,
  subject text,
  subject_te text,
  pdf_url text,
  superseded_by uuid
)
language sql
stable
as $$
  select
    c.id, c.document_id, c.seq, c.content, c.page,
    d.go_number, d.go_type, d.dept, d.issue_date, d.subject, d.subject_te,
    d.pdf_url, d.superseded_by
  from documents d
  join chunks c on c.document_id = d.id
  where d.status = 'approved'
    -- Whitespace and punctuation vary across the corpus ("G.O.Ms.No.51",
    -- "GO Ms No 51"), so compare on a squeezed, case-folded form.
    and regexp_replace(lower(d.go_number), '[^a-z0-9]', '', 'g')
        = regexp_replace(lower(go_number_query), '[^a-z0-9]', '', 'g')
  order by c.seq
  limit match_count;
$$;

comment on function chunks_for_go_number is
  'Exact GO-number lookup for the retrieval short-circuit, matching on a punctuation-stripped form. Returns chunks in document order.';

grant execute on function chunks_for_go_number(text, integer) to anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────
-- 20260803000005_seed_rates.sql
-- ───────────────────────────────────────────────────────────────────────

-- Migration 005 — seed the rates table (PLAN.md Part 4, CLAUDE.md rule 1).
--
-- GENERATED FILE — do not edit by hand.
-- Source of truth: config/rates/rps-2022.json
-- Regenerate:      pnpm rates:generate
--
-- ############################################################################
-- #  EVERY UNVERIFIED VALUE IN THIS FILE IS UNCONFIRMED.                     #
-- #                                                                          #
-- #  A row is confirmed only when source_go.verified is true in the JSON,    #
-- #  meaning a person opened that Government Order and checked the figure    #
-- #  and its effective date. Everything else came from public summaries.     #
-- #                                                                          #
-- #  payload->'_unverified' is true on every unconfirmed row. The            #
-- #  calculators read it and show a warning, so an unchecked rate cannot     #
-- #  quietly present itself as authoritative. Run pnpm rates:worksheet to    #
-- #  see what is left.                                                       #
-- ############################################################################
--
-- source_go stays null: it references documents(id), and the GOs may not be
-- ingested yet. The GO number travels in payload->'_source_go' so the admin can
-- link the row once the document exists.

-- Idempotent: re-running replaces the seed rather than duplicating it. Rows an
-- admin has since verified in the database are preserved.
delete from rates where payload ->> '_unverified' = 'true';


-- DA
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2018-07-01'::date, '2018-12-31'::date, '{"percent":0,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":"Base; merged into RPS-2022 fitment"}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2019-01-01'::date, '2019-06-30'::date, '{"percent":2.73,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2019-07-01'::date, '2019-12-31'::date, '{"percent":7.28,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2020-01-01'::date, '2020-06-30'::date, '{"percent":10.92,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2020-07-01'::date, '2020-12-31'::date, '{"percent":13.65,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2021-01-01'::date, '2021-06-30'::date, '{"percent":17.29,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2021-07-01'::date, '2021-12-31'::date, '{"percent":20.02,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2022-01-01'::date, '2022-06-30'::date, '{"percent":22.75,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":"G.O.Ms.No.66","go_date":"2023-05-01","verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2022-07-01'::date, '2022-12-31'::date, '{"percent":26.39,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":"G.O.Ms.No.113","go_date":null,"verified":false,"note":"GO number from research; date unconfirmed"}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2023-01-01'::date, '2023-06-30'::date, '{"percent":30.03,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":"G.O.Ms.No.28","go_date":null,"verified":false,"note":"CANDIDATE from web search, not confirmed — two searches place No.28 at 26.39%→30.03% w.e.f. 01-01-2023, an earlier one placed it at 22.75%→26.39% w.e.f. 01-07-2022. Confirm against the PDF before trusting either."}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2023-07-01'::date, '2023-12-31'::date, '{"percent":33.67,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":"G.O.Ms.No.30","go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2024-01-01'::date, null, '{"percent":37.31,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":"G.O.Ms.No.60","go_date":"2025-10-20","verified":false,"note":"Modified by G.O.Ms.No.62"}}'::jsonb, null);

-- HRA
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('HRA', '2022-01-01'::date, null, '{"slabs":[{"percent":24,"band":"Population above 50 lakh","examples":["Hyderabad","New Delhi"]},{"percent":16,"band":"Population 5-50 lakh","examples":["Visakhapatnam (GVMC)","Vijayawada","Guntur","Nellore","Velagapudi Secretariat"]},{"percent":12,"band":"Population 50,000-5 lakh","examples":[]},{"percent":10,"band":"Population below 50,000","examples":[]}],"census":"2011","applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":"G.O.27","go_date":null,"verified":false,"note":"Revised the original 8/16/24% slabs in G.O.Ms.No.1; date and exact population bands UNCONFIRMED"}}'::jsonb, null);

-- MASTER_SCALE
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('MASTER_SCALE', '2022-07-01'::date, null, '{"segments":"20000-600-21800-660-23780-720-25940-780-28280-850-30830-920-33590-990-36560-1080-39800-1170-43310-1260-47090-1350-51140-1460-55520-1580-60260-1700-65360-1830-70850-1960-76730-2090-83000-2240-89720-2390-96890-2540-104510-2700-112610-2890-121280-3100-130580-3320-140540-3610-154980-3900-170580-4210-179000","stages":[20000,20600,21200,21800,22460,23120,23780,24500,25220,25940,26720,27500,28280,29130,29980,30830,31750,32670,33590,34580,35570,36560,37640,38720,39800,40970,42140,43310,44570,45830,47090,48440,49790,51140,52600,54060,55520,57100,58680,60260,61960,63660,65360,67190,69020,70850,72810,74770,76730,78820,80910,83000,85240,87480,89720,92110,94500,96890,99430,101970,104510,107210,109910,112610,115500,118390,121280,124380,127480,130580,133900,137220,140540,144150,147760,151370,154980,158880,162780,166680,170580,174790,179000],"stage_count":83,"grades":32,"minimum":20000,"maximum":179000,"ir_counts_as_pay_for_fixation":false,"_unverified":true,"_source_go":{"go_number":"G.O.Ms.No.1","go_date":"2022-01-17","verified":false,"note":"AP Revised Scales of Pay Rules 2022; 23% fitment, 30.392% DA merged"}}'::jsonb, null);

-- NPS
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('NPS', '2004-09-01'::date, null, '{"employee_percent":10,"government_percent":14,"base":"basic_pay_plus_da","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":"Contribution rates widely reported; sanctioning GO NOT identified — verify before the CPS projector ships"}}'::jsonb, null);

-- IT_SLAB
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('IT_SLAB', '2025-04-01'::date, '2026-03-31'::date, '{"regime":"new","fy":"2025-26","slabs":[{"upto":400000,"percent":0},{"upto":800000,"percent":5},{"upto":1200000,"percent":10},{"upto":1600000,"percent":15},{"upto":2000000,"percent":20},{"upto":2400000,"percent":25},{"upto":null,"percent":30}],"standard_deduction":75000,"rebate_87a_upto":1200000,"cess_percent":4,"surcharge":"as per Finance Act","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":"Union Budget 2025 new regime — central, not an AP GO. Verify against the Finance Act."}}'::jsonb, null);

-- ───────────────────────────────────────────────────────────────────────
-- 20260803000006_auth_and_consent.sql
-- ───────────────────────────────────────────────────────────────────────

-- Migration 006 — link profiles to auth, and make consent auditable (Phase 6).
--
-- CLAUDE.md rule 7: log consent, and provide a delete-my-data endpoint. Both
-- are DPDP obligations, and neither is satisfied by a checkbox that leaves no
-- record — "we asked" has to be provable after the fact.

-- ---------------------------------------------------------------------------
-- users.id becomes the auth user's id.
--
-- Not a separate auth_user_id column: one identity per person, so a profile
-- cannot drift from the account that owns it, and RLS can compare against
-- auth.uid() directly instead of through a join.
-- ---------------------------------------------------------------------------
alter table users
  add constraint users_id_fkey
  foreign key (id) references auth.users (id) on delete cascade;

comment on constraint users_id_fkey on users is
  'users.id IS the auth user id. ON DELETE CASCADE means deleting the auth account removes the profile — half of the delete-my-data guarantee.';

-- ---------------------------------------------------------------------------
-- Consent log.
--
-- Append-only by policy: consent is a history, not a current value. "Did this
-- person consent on the day we processed their data?" is the question a
-- regulator asks, and a mutable boolean cannot answer it.
-- ---------------------------------------------------------------------------
create table consent_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- e.g. 'profile_storage', 'chat_logging'
  purpose     text not null,
  granted     boolean not null,
  -- The exact wording shown, so we can prove what was agreed to and not merely
  -- that something was.
  policy_text text,
  policy_version text,
  created_at  timestamptz not null default now()
);

create index consent_events_user_idx on consent_events (user_id, created_at desc);

alter table consent_events enable row level security;

-- A person may read their own consent history; nobody may edit it.
create policy consent_events_own_read on consent_events
  for select to authenticated
  using (user_id = auth.uid());

create policy consent_events_own_insert on consent_events
  for insert to authenticated
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Profile access.
--
-- Until now users was service-role only. With auth in place a person reads and
-- writes their own row and no one else's.
-- ---------------------------------------------------------------------------
create policy users_own_read on users
  for select to authenticated
  using (id = auth.uid());

create policy users_own_insert on users
  for insert to authenticated
  with check (id = auth.uid());

create policy users_own_update on users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy users_own_delete on users
  for delete to authenticated
  using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- Chat logs belong to their author once there is an author.
--
-- chat_logs.session is an opaque per-tab string for anonymous visitors; a
-- signed-in person's rows carry their id so delete-my-data can reach them.
-- ---------------------------------------------------------------------------
alter table chat_logs add column user_id uuid references auth.users (id) on delete set null;

create index chat_logs_user_idx on chat_logs (user_id) where user_id is not null;

comment on column chat_logs.user_id is
  'Null for anonymous visitors. ON DELETE SET NULL rather than CASCADE: deleting an account must erase the link to the person, but the answer quality signal (the thumbs-down) stays useful and is no longer personal data.';

create policy chat_logs_own_read on chat_logs
  for select to authenticated
  using (user_id = auth.uid());

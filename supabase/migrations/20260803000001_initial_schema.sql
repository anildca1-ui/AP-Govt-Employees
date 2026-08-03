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

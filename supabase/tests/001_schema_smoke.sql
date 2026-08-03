-- Smoke test for migration 001. Every check raises an exception on failure, so
-- a clean run means the schema behaves as the migration intends.
--
--   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/001_schema_smoke.sql
--
-- Or, against the local stack: `pnpm db:start && pnpm db:test`.
--
-- Run it against a database that has had 20260803000001_initial_schema.sql
-- applied. It rolls back, so it leaves no rows behind.
-- On a bare Postgres cluster you also need the roles Supabase provides:
--   create role anon nologin; create role authenticated nologin;
--   create role service_role nologin bypassrls;
--   grant usage on schema public to anon, authenticated;
--   grant all on all tables in schema public to anon, authenticated;

\set ON_ERROR_STOP on

begin;

-- --- structure ---------------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(t, ', ') into missing
  from unnest(array['documents','chunks','rates','chat_logs','ingest_queue','users']) t
  where to_regclass('public.' || t) is null;
  if missing is not null then
    raise exception 'missing tables: %', missing;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_am am on am.oid = c.relam
    where c.relname = 'chunks_embedding_idx' and am.amname = 'hnsw'
  ) then
    raise exception 'chunks.embedding is not backed by an HNSW index';
  end if;

  if not exists (
    select 1 from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_am am on am.oid = c.relam
    where c.relname = 'chunks_tsv_idx' and am.amname = 'gin'
  ) then
    raise exception 'chunks.tsv is not backed by a GIN index';
  end if;
end $$;

-- --- rule 6: nothing is approved by default ----------------------------------
insert into documents (go_number, go_type, dept, issue_date, subject, sha256)
values ('G.O.Ms.No.51', 'Ms', 'Finance', date '2025-04-01', 'Dearness Allowance', 'sha-pending');

do $$
begin
  if (select status from documents where sha256 = 'sha-pending') <> 'pending' then
    raise exception 'documents.status must default to pending (CLAUDE.md rule 6)';
  end if;
end $$;

-- --- dedupe: the same PDF cannot land twice ----------------------------------
do $$
begin
  begin
    insert into documents (sha256) values ('sha-pending');
    raise exception 'duplicate sha256 was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- --- check constraints -------------------------------------------------------
do $$
declare doc_id uuid;
begin
  begin
    insert into documents (sha256, go_type) values ('sha-bad-type', 'Notification');
    raise exception 'invalid go_type was accepted';
  exception when check_violation then null;
  end;

  begin
    insert into documents (sha256, status) values ('sha-bad-status', 'live');
    raise exception 'invalid status was accepted';
  exception when check_violation then null;
  end;

  select id into doc_id from documents where sha256 = 'sha-pending';
  begin
    update documents set superseded_by = doc_id where id = doc_id;
    raise exception 'a GO was allowed to supersede itself';
  exception when check_violation then null;
  end;

  begin
    insert into rates (kind, effective_from, effective_to, payload)
    values ('DA', date '2025-07-01', date '2025-01-01', '{}'::jsonb);
    raise exception 'a rate period ending before it starts was accepted';
  exception when check_violation then null;
  end;
end $$;

-- --- chunks: 1024-d embedding + generated bilingual tsv -----------------------
insert into documents (go_number, go_type, dept, issue_date, subject, sha256, status)
values ('G.O.Ms.No.52', 'Ms', 'Finance', date '2025-04-02', 'DA sanction', 'sha-approved', 'approved');

insert into chunks (document_id, seq, content, content_te, embedding, page)
select id, 1,
       'Dearness Allowance sanctioned at 3.64 percent',
       'కరువు భత్యం మంజూరు చేయబడింది',
       (select array_agg(0.001::real)::vector from generate_series(1, 1024)),
       1
from documents where sha256 = 'sha-approved';

do $$
begin
  -- English side of the generated column
  if not exists (select 1 from chunks where tsv @@ to_tsquery('simple', 'dearness')) then
    raise exception 'generated tsv does not match English content';
  end if;
  -- Telugu side: the reason the config is 'simple' and not 'english'
  if not exists (select 1 from chunks where tsv @@ to_tsquery('simple', 'కరువు')) then
    raise exception 'generated tsv does not match Telugu content';
  end if;
end $$;

do $$
begin
  begin
    insert into chunks (document_id, seq, content, embedding)
    select id, 2, 'wrong size', (select array_agg(0.5::real)::vector from generate_series(1, 512))
    from documents where sha256 = 'sha-approved';
    raise exception 'a 512-dimension embedding was accepted into a vector(1024) column';
  exception when data_exception then null;
  end;

  begin
    insert into chunks (document_id, seq, content)
    select id, 1, 'duplicate seq' from documents where sha256 = 'sha-approved';
    raise exception 'duplicate (document_id, seq) was accepted';
  exception when unique_violation then null;
  end;
end $$;

-- --- cosine distance works over the stored vectors ----------------------------
do $$
declare hits integer;
begin
  select count(*) into hits
  from (
    select id from chunks
    order by embedding <=> (select array_agg(0.001::real)::vector from generate_series(1, 1024))
    limit 5
  ) t;
  if hits <> 1 then
    raise exception 'cosine ordering over chunks.embedding returned % rows, expected 1', hits;
  end if;
end $$;

-- --- ingest_queue dedupe (migration 002) -------------------------------------
do $$
begin
  insert into ingest_queue (source, raw_url, sha256) values ('goir', 'https://a.pdf', 'sha-queued');

  begin
    -- Same bytes reaching us again, from a different source and URL.
    insert into ingest_queue (source, raw_url, sha256) values ('whatsapp', 'https://b.pdf', 'sha-queued');
    raise exception 'the same PDF was queued twice — rule 3 dedupe is not enforced';
  exception when unique_violation then null;
  end;

  -- Rows still awaiting download have no hash yet, and several may coexist.
  insert into ingest_queue (source, raw_url) values ('goir', 'https://c.pdf');
  insert into ingest_queue (source, raw_url) values ('goir', 'https://d.pdf');
end $$;

-- --- RLS: the library is public, the queue and the users are not --------------
insert into rates (kind, effective_from, payload) values ('DA', date '2025-01-01', '{"percent": 3.64}');
insert into chat_logs (question, lang) values ('DA ఎంత?', 'te');
insert into ingest_queue (source, raw_url) values ('goir', 'https://goir.ap.gov.in/x.pdf');
insert into users (phone, basic_pay, cps_or_ops) values ('+910000000000', 52590, 'CPS');

set local role anon;

do $$
begin
  if exists (select 1 from documents where sha256 = 'sha-pending') then
    raise exception 'anon can read a pending document — rule 6 is not enforced';
  end if;
  if not exists (select 1 from documents where sha256 = 'sha-approved') then
    raise exception 'anon cannot read an approved document — the GO library would be empty';
  end if;
  if exists (select 1 from chunks c join documents d on d.id = c.document_id where d.sha256 = 'sha-pending') then
    raise exception 'anon can read chunks of an unapproved document';
  end if;
  if not exists (select 1 from rates) then
    raise exception 'anon cannot read rates — client-side calculators would have no rates';
  end if;
  if exists (select 1 from chat_logs) then
    raise exception 'anon can read chat_logs';
  end if;
  if exists (select 1 from ingest_queue) then
    raise exception 'anon can read ingest_queue';
  end if;
  if exists (select 1 from users) then
    raise exception 'anon can read users — personal data is exposed';
  end if;
end $$;

-- anon holds table grants in Supabase, so RLS is what must block writes.
-- Note the asymmetry: INSERT raises (no policy means the WITH CHECK fails),
-- while UPDATE and DELETE simply match zero rows and report success. Asserting
-- on "did it throw?" would silently pass for UPDATE, so assert on rows affected.
do $$
declare touched integer;
begin
  begin
    insert into documents (sha256, status) values ('sha-anon-write', 'approved');
    raise exception 'anon inserted a document';
  exception when insufficient_privilege then null;
  end;

  update documents set status = 'approved' where sha256 = 'sha-pending';
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'anon updated % document row(s) — a visitor could self-approve a GO', touched;
  end if;

  delete from documents where sha256 = 'sha-approved';
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'anon deleted % document row(s)', touched;
  end if;

  update rates set payload = '{"percent": 999}'::jsonb;
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'anon rewrote % rate row(s) — every calculator would be wrong', touched;
  end if;
end $$;

reset role;

-- The blocked writes must have left the data untouched.
do $$
begin
  if (select status from documents where sha256 = 'sha-pending') <> 'pending' then
    raise exception 'a pending document was modified by anon after all';
  end if;
  if not exists (select 1 from documents where sha256 = 'sha-approved') then
    raise exception 'an approved document was deleted by anon after all';
  end if;
  if (select payload ->> 'percent' from rates limit 1) <> '3.64' then
    raise exception 'a rate row was modified by anon after all';
  end if;
end $$;

rollback;

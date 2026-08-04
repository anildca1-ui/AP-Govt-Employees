-- Smoke test for the schema. Every check raises an exception on failure, so a
-- clean run means the schema behaves as the migrations intend.
--
--   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/001_schema_smoke.sql
--
-- Or, against the local stack: `pnpm db:start && pnpm db:test`.
-- Or, end to end from nothing: `scripts/schema-check.sh`.
--
-- Run it against a database with EVERY migration in supabase/migrations applied,
-- not just 001 — the assertions below cover the whole chain, and a rate seeded
-- by 005 or a foreign key added by 006 changes what the earlier tables accept.
-- It rolls back, so it leaves no rows behind.
--
-- On a bare Postgres cluster, apply supabase/tests/000_supabase_shim.sql first
-- for the roles, the auth schema and the grants Supabase would provide.

\set ON_ERROR_STOP on

-- Fixed ids rather than gen_random_uuid(): users.id is a foreign key to
-- auth.users, so the profile and the account it belongs to have to agree, and
-- auth.uid() has to be settable to the same value further down.
\set user_a '11111111-1111-4111-8111-111111111111'
\set user_b '22222222-2222-4222-8222-222222222222'
\set no_account 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

begin;

-- psql substitutes :'user_a' in plain SQL but not inside a dollar-quoted
-- PL/pgSQL body, so the same ids are also carried as settings for the do blocks
-- to read. Both come from the \set above; neither is a second copy to update.
set local smoke.user_a = :'user_a';
set local smoke.user_b = :'user_b';
set local smoke.no_account = :'no_account';

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

-- --- watch_seen: discovery bookkeeping (migration 003) -----------------------
do $$
begin
  insert into watch_seen (site, url) values ('apemp', 'https://apemp.in/go-51');

  begin
    -- A second nightly run seeing the same sitemap entry must be a no-op.
    insert into watch_seen (site, url) values ('apemp', 'https://apemp.in/go-51');
    raise exception 'the same (site, url) was recorded twice — the diff would re-queue nightly';
  exception when unique_violation then null;
  end;

  -- The same URL path on a different site is a different discovery.
  insert into watch_seen (site, url) values ('gunturbadi', 'https://apemp.in/go-51');
end $$;

-- --- RLS: the library is public, the queue and the users are not --------------
-- Migration 005 seeds sixteen rates, so this row is tagged to stay findable
-- among them. Asserting on `from rates limit 1` would read whichever row the
-- heap happened to return.
insert into rates (kind, effective_from, payload)
values ('DA', date '2025-01-01', '{"percent": 3.64, "_smoke_test": true}');
insert into chat_logs (question, lang) values ('DA ఎంత?', 'te');
insert into ingest_queue (source, raw_url) values ('goir', 'https://goir.ap.gov.in/x.pdf');

-- A profile needs an account: migration 006 made users.id a foreign key to
-- auth.users(id).
insert into auth.users (id) values (:'user_a');
insert into users (id, phone, basic_pay, cps_or_ops)
values (:'user_a', '+910000000000', 52590, 'CPS');

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
  if exists (select 1 from watch_seen) then
    raise exception 'anon can read watch_seen — crawler bookkeeping is exposed';
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
  if (select payload ->> 'percent' from rates where payload ->> '_smoke_test' = 'true')
     is distinct from '3.64' then
    raise exception 'a rate row was modified by anon after all';
  end if;
end $$;

-- --- migration 006: accounts, consent, and delete-my-data ---------------------
-- CLAUDE.md rule 7 is a DPDP obligation, and the database is where it is either
-- kept or quietly broken. These assertions are the enforceable half of it.

-- A profile must belong to a real account. Without the foreign key, a stale or
-- forged id creates a row no account owns — and delete-my-data never reaches it,
-- because there is no account to delete.
do $$
begin
  begin
    insert into users (id, phone)
    values (current_setting('smoke.no_account')::uuid, '+919999999999');
    raise exception 'a profile was created for an id with no auth account';
  exception when foreign_key_violation then null;
  end;
end $$;

-- A second account, so "your own row" is a claim with something to exclude.
insert into auth.users (id) values (:'user_b');
insert into users (id, phone, basic_pay, cps_or_ops)
values (:'user_b', '+910000000001', 41000, 'OPS');

insert into consent_events (user_id, purpose, granted, policy_text, policy_version)
values (:'user_a', 'profile_storage', true, 'Stores your basic pay to prefill calculators.', '2026-08-01');
insert into consent_events (user_id, purpose, granted, policy_text, policy_version)
values (:'user_b', 'chat_logging', true, 'Keeps your questions to improve answers.', '2026-08-01');

insert into chat_logs (question, lang, user_id, feedback)
values ('నా DA ఎంత?', 'te', :'user_a', -1);
insert into chat_logs (question, lang, user_id)
values ('HRA slab for Vijayawada?', 'en', :'user_b');

set local role authenticated;
set local "request.jwt.claim.sub" = :'user_a';

do $$
declare touched integer;
begin
  if auth.uid() is null then
    raise exception 'auth.uid() is null — the rest of this section would assert nothing';
  end if;

  -- Read isolation. One employee's basic pay must not be visible to another.
  if not exists (select 1 from users where id = auth.uid()) then
    raise exception 'a signed-in person cannot read their own profile';
  end if;
  if exists (select 1 from users where id <> auth.uid()) then
    raise exception 'a signed-in person can read another employee''s profile';
  end if;
  if exists (select 1 from consent_events where user_id <> auth.uid()) then
    raise exception 'a signed-in person can read another person''s consent history';
  end if;
  if exists (select 1 from chat_logs where user_id is distinct from auth.uid()) then
    raise exception 'a signed-in person can read another person''s chat history';
  end if;

  -- Append-only consent. A mutable record cannot answer "did they consent on the
  -- day we processed their data?", which is the question that actually gets asked.
  update consent_events set granted = false where user_id = auth.uid();
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'a consent event was rewritten — the log is not append-only';
  end if;

  delete from consent_events where user_id = auth.uid();
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'a consent event was deleted — the log is not append-only';
  end if;

  -- Recording consent is the one write that must work.
  insert into consent_events (user_id, purpose, granted)
  values (auth.uid(), 'chat_logging', true);

  begin
    insert into consent_events (user_id, purpose, granted)
    values (current_setting('smoke.user_b')::uuid, 'chat_logging', true);
    raise exception 'consent was recorded on another person''s behalf';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- Delete-my-data. Deleting the account has to take the profile and the consent
-- history with it, and has to unlink — not delete — the answer-quality signal.
do $$
declare
  a uuid := current_setting('smoke.user_a')::uuid;
  b uuid := current_setting('smoke.user_b')::uuid;
  survivors integer;
begin
  delete from auth.users where id = a;

  select count(*) into survivors from users where id = a;
  if survivors <> 0 then
    raise exception 'the profile survived deletion of its account';
  end if;

  select count(*) into survivors from consent_events where user_id = a;
  if survivors <> 0 then
    raise exception 'consent history survived deletion of its account';
  end if;

  if not exists (
    select 1 from chat_logs where question = 'నా DA ఎంత?' and user_id is null and feedback = -1
  ) then
    raise exception 'the chat log was deleted or kept its user link — ON DELETE SET NULL is not in effect';
  end if;

  -- The other account is untouched: deleting one person is not deleting everyone.
  if not exists (select 1 from users where id = b) then
    raise exception 'deleting one account removed another';
  end if;
  if not exists (select 1 from consent_events where user_id = b) then
    raise exception 'deleting one account removed another account''s consent history';
  end if;
end $$;

rollback;

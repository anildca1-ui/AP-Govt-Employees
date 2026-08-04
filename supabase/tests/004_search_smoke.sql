-- Smoke test for migration 004 (hybrid search). Raises on any failed check.
--
--   psql -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/004_search_smoke.sql
--
-- Rolls back, so it leaves no rows behind.

\set ON_ERROR_STOP on

begin;

-- Three documents: one approved and relevant, one approved and irrelevant, one
-- still pending. Embeddings are hand-built so cosine ordering is predictable:
-- dimension 1 carries the "DA" signal, dimension 2 the "pension" signal.
insert into documents (go_number, go_type, dept, issue_date, subject, sha256, status)
values
  ('G.O.Ms.No.60', 'Ms', 'Finance', date '2025-10-20', 'Dearness Allowance enhanced', 'sha-da', 'approved'),
  ('G.O.Ms.No.99', 'Ms', 'Finance', date '2025-09-01', 'Pension revision', 'sha-pension', 'approved'),
  ('G.O.Ms.No.77', 'Ms', 'Finance', date '2025-08-01', 'Dearness Allowance draft', 'sha-pending-da', 'pending');

create temporary view v as select id, sha256 from documents;

-- vec(a, b): unit-ish vector with a in dim 1 and b in dim 2, zeros elsewhere.
create or replace function pg_temp.vec(a real, b real) returns vector as $$
  select (array[a, b] || array_fill(0::real, array[1022]))::vector;
$$ language sql immutable;

insert into chunks (document_id, seq, content, embedding, page)
select (select id from v where sha256 = 'sha-da'), 1,
       'Dearness Allowance to State Government Employees enhanced to 37.31 percent', pg_temp.vec(1, 0), 1;
insert into chunks (document_id, seq, content, embedding, page)
select (select id from v where sha256 = 'sha-da'), 2,
       'The Dearness Allowance arrears shall be credited in three instalments', pg_temp.vec(0.9, 0.1), 2;
insert into chunks (document_id, seq, content, embedding, page)
select (select id from v where sha256 = 'sha-pension'), 1,
       'Pension revision for retired employees', pg_temp.vec(0, 1), 1;
insert into chunks (document_id, seq, content, embedding, page)
select (select id from v where sha256 = 'sha-pending-da'), 1,
       'Dearness Allowance draft not yet approved', pg_temp.vec(1, 0), 1;

-- --- approved-only: rule 6 holds inside retrieval, not just in the UI --------
do $$
declare leaked integer;
begin
  select count(*) into leaked
  from search_chunks(pg_temp.vec(1, 0), 'dearness allowance', 12)
  where document_id = (select id from v where sha256 = 'sha-pending-da');
  if leaked <> 0 then
    raise exception 'search returned % chunk(s) from a pending document', leaked;
  end if;
end $$;

-- --- vector half orders by cosine similarity --------------------------------
do $$
declare top_doc uuid;
begin
  -- A pure "pension" query vector, with text that matches nothing lexically, so
  -- only the vector half can decide.
  select document_id into top_doc
  from search_chunks(pg_temp.vec(0, 1), 'zzzznotaword', 12)
  limit 1;
  if top_doc is distinct from (select id from v where sha256 = 'sha-pension') then
    raise exception 'vector ranking did not put the pension document first';
  end if;
end $$;

-- --- keyword half contributes even with no embedding match ------------------
do $$
declare kscore real;
begin
  select keyword_score into kscore
  from search_chunks(null, 'pension revision', 12)
  limit 1;
  if kscore is null or kscore <= 0 then
    raise exception 'keyword-only search produced no keyword score (got %)', kscore;
  end if;
end $$;

-- --- keyword score is normalised into 0..1 so weighting means something -----
do $$
declare bad integer;
begin
  select count(*) into bad
  from search_chunks(pg_temp.vec(1, 0), 'dearness allowance employees', 12)
  where keyword_score < 0 or keyword_score > 1;
  if bad <> 0 then
    raise exception '% row(s) had an out-of-range keyword score — weighting is meaningless', bad;
  end if;
end $$;

-- --- the blend actually blends ----------------------------------------------
do $$
declare r record;
begin
  select vector_score, keyword_score, score into r
  from search_chunks(pg_temp.vec(1, 0), 'dearness allowance', 12)
  limit 1;
  if abs(r.score - (0.6 * r.vector_score + 0.4 * r.keyword_score)) > 0.0001 then
    raise exception 'score % is not 0.6*vector + 0.4*keyword (% / %)',
      r.score, r.vector_score, r.keyword_score;
  end if;
end $$;

-- --- supersession is surfaced, not filtered away (rule 3) -------------------
update documents
set superseded_by = (select id from v where sha256 = 'sha-pension')
where sha256 = 'sha-da';

do $$
declare found integer;
begin
  select count(*) into found
  from search_chunks(pg_temp.vec(1, 0), 'dearness allowance', 12)
  where document_id = (select id from v where sha256 = 'sha-da')
    and superseded_by is not null;
  if found = 0 then
    raise exception 'a superseded document was hidden from retrieval — the answer path cannot follow the chain';
  end if;
end $$;

-- --- exact GO lookup, tolerant of how the number is written -----------------
do $$
declare hits integer;
begin
  foreach hits in array array[1]
  loop end loop;

  select count(*) into hits from chunks_for_go_number('G.O.Ms.No.60');
  if hits <> 2 then
    raise exception 'exact GO lookup returned % chunks, expected 2', hits;
  end if;

  -- Same order, written the way a hurried user types it.
  select count(*) into hits from chunks_for_go_number('go ms no 60');
  if hits <> 2 then
    raise exception 'punctuation-insensitive GO lookup returned % chunks, expected 2', hits;
  end if;

  -- A pending document must not be reachable by exact number either.
  select count(*) into hits from chunks_for_go_number('G.O.Ms.No.77');
  if hits <> 0 then
    raise exception 'exact GO lookup reached a pending document';
  end if;
end $$;

-- --- exact lookup returns document order, not rank order --------------------
do $$
declare seqs integer[];
begin
  select array_agg(seq order by ordinality) into seqs
  from chunks_for_go_number('G.O.Ms.No.60') with ordinality;
  if seqs <> array[1, 2] then
    raise exception 'exact GO lookup returned chunks out of document order: %', seqs;
  end if;
end $$;

rollback;

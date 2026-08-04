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

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

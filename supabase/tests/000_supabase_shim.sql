-- Everything the migrations assume exists because Supabase provides it, and a
-- bare Postgres cluster does not. Apply this BEFORE the migrations.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/000_supabase_shim.sql
--
-- Do not run it against the Supabase local stack or a hosted project: there the
-- real objects already exist, and this would replace auth.uid() with an
-- approximation of itself.
--
-- The point of the shim is that CI can apply and test the schema without a
-- Supabase container. It only earns that if it behaves like the real thing —
-- a shim that is easier to satisfy than production turns CI green on schemas
-- that would fail on deploy. Keep it faithful, or delete it and pay for the
-- container.

-- ---------------------------------------------------------------------------
-- Roles.
--
-- anon and authenticated are what RLS policies name; service_role bypasses RLS
-- and is what the ingestion pipeline and the admin queue run as.
-- ---------------------------------------------------------------------------
do $$
begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;

do $$
begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;

do $$
begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants the API roles table privileges as tables are created, so RLS
-- is the only thing standing between a visitor and a row. Granting the same way
-- here — by default privilege, before the migrations run — means the RLS
-- assertions test the policies rather than tripping over a missing GRANT.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- auth schema.
--
-- Migration 006 puts auth.users at the centre of the data model: users.id IS
-- the auth user id, and consent_events and chat_logs.user_id reference it. Only
-- the id column matters to our schema, so only the id column is shimmed.
-- ---------------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
);

-- Mirrors Supabase's own definition, including the fallback: PostgREST has set
-- the claim through both GUCs across versions, and a policy that works with one
-- form must work with the other. Supporting only the form our tests happen to
-- set would make CI a weaker gate than production.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

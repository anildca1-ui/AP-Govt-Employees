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

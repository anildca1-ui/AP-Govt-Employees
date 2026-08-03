# supabase/

Database, storage and auth for `ap-emp-ai`.

- `migrations/` — SQL migrations, applied in filename order. Migration `001` creates
  the schema in `PLAN.md` Part 3 (`documents`, `chunks`, `rates`, `chat_logs`,
  `ingest_queue`, `users`) plus the pgvector HNSW and tsvector GIN indexes.
  That is Phase 0 task 2 — this directory is the scaffold for it.

Local stack (`supabase start`, `supabase/config.toml`) is set up in that same task.
Service keys live in `.env` only and are never committed (CLAUDE.md hard rule 7).

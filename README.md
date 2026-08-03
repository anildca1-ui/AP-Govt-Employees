# ap-emp-ai

Telugu-first portal, RAG chatbot and calculator suite for Andhra Pradesh government employees.

Not an official Government of Andhra Pradesh website. Every AI answer cites the GO
it came from; verify against the original GO before acting on anything here.

## Getting started

```bash
pnpm install
cp .env.example .env     # then fill in — .env is never committed
pnpm db:start            # local Supabase stack (needs Docker)
pnpm dev                 # http://localhost:3000
```

## Checks

```bash
pnpm lint        # eslint across the workspace
pnpm test        # vitest, all packages
pnpm build       # packages (tsc) then the Next app
pnpm typecheck   # includes test files
pnpm db:test     # schema smoke test against the local stack
```

CI runs lint · test · build, plus the migration and schema smoke test against
Postgres 17 + pgvector. See `.github/workflows/ci.yml`.

## Layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js 15 App Router UI and API routes |
| `packages/calc` | Pure calculation functions, one per calculator (PLAN.md Part 4) |
| `packages/ingest` | Scrapers and the PDF → chunk → embed pipeline |
| `packages/rag` | Hybrid retrieval and grounded answering |
| `supabase` | Migrations, local stack config, schema tests |

## Documents

- `CLAUDE.md` — operating rules. Read this first.
- `PLAN.md` — product spec, architecture, DB schema, calculator formulas.
- `TASKS.md` — phase-ordered task list.
- `PROGRESS.md` — running build log.

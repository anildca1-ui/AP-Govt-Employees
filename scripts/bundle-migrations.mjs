/**
 * Bundles every migration into one file to paste into Supabase's SQL Editor.
 *
 *     pnpm db:bundle           # rewrite the bundle
 *     pnpm db:bundle --check   # fail if it is out of date (CI)
 *
 * SETUP.md used to ask the owner to open six files and paste each one in the
 * right order, waiting for "Success" between them. That is six chances to skip
 * a file, paste a partial selection, or lose track of the order — and the
 * failure is not obvious, because a half-built schema still looks like a
 * working database until the first page tries to read a table that is missing.
 *
 * One file, one paste, one Success. The order is fixed here where it can be
 * checked, rather than in a person's attention.
 *
 * The bundle is not re-runnable, and the header says so rather than claiming
 * otherwise — an earlier draft of this file promised "safe to run twice", and
 * applying it twice to a real Postgres stopped at `relation "documents"
 * already exists`. A reassurance that is wrong is worse than no reassurance:
 * the person reading it is the one who cannot tell.
 *
 * Generated, never hand-edited: --check runs in CI so the bundle cannot drift
 * from the migrations it is built from. A stale bundle would build yesterday's
 * schema and give no sign of it.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationsDir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
const bundlePath = fileURLToPath(new URL("../supabase/all-migrations.sql", import.meta.url));

/** Sorted by filename, which is how the timestamps encode the order. */
const files = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

function build() {
  const header = `-- ═══════════════════════════════════════════════════════════════════════
-- EVERY MIGRATION, IN ORDER — paste this whole file into Supabase's SQL
-- Editor and press Run. Once. That builds the entire database.
--
-- GENERATED FILE — do not edit by hand.
-- Source:     supabase/migrations/*.sql  (${files.length} files)
-- Regenerate: pnpm db:bundle
--
-- Run it ONCE. If you run it again you will see red errors saying things
-- "already exist" — that means the database is already built. Nothing is
-- damaged and nothing is duplicated; the second run simply stops.
-- ═══════════════════════════════════════════════════════════════════════

`;

  const parts = files.map((name) => {
    const sql = readFileSync(`${migrationsDir}/${name}`, "utf8").trimEnd();
    return (
      `-- ───────────────────────────────────────────────────────────────────────\n` +
      `-- ${name}\n` +
      `-- ───────────────────────────────────────────────────────────────────────\n\n` +
      `${sql}\n`
    );
  });

  return `${header}${parts.join("\n")}`;
}

const generated = build();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(bundlePath, "utf8");
  } catch {
    current = "";
  }
  if (current !== generated) {
    console.error(
      "supabase/all-migrations.sql is out of date with supabase/migrations/.\n" +
        "Anyone following SETUP.md would build the wrong schema.\n" +
        "Run: pnpm db:bundle",
    );
    process.exit(1);
  }
  console.log(`migration bundle is in step with all ${files.length} migrations.`);
} else {
  writeFileSync(bundlePath, generated);
  console.log(`Bundled ${files.length} migrations → supabase/all-migrations.sql`);
}

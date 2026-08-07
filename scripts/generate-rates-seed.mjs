/**
 * Regenerates the rates seed migration from config/rates/rps-2022.json.
 *
 *     pnpm rates:generate           # rewrite the migration
 *     pnpm rates:generate --check   # fail if it is out of date (CI)
 *
 * The migration's own header says to edit the JSON and regenerate, and never to
 * hand-edit the SQL — but no generator existed, so the only way to apply a
 * verified rate was to hand-edit the thing the file forbids hand-editing.
 *
 * That matters more than tidiness. The JSON is bundled into the browser for the
 * calculators; the SQL seeds the database the server reads. If they drift, the
 * figure on the page and the figure in the database disagree about what an
 * employee is owed, and nothing fails loudly. Sixteen rates are about to be
 * verified one by one, which is sixteen chances for that to happen.
 *
 * `_unverified` stays true for any row whose source_go.verified is not true, so
 * the on-screen warning clears per rate exactly as each is confirmed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const configPath = fileURLToPath(new URL("../config/rates/rps-2022.json", import.meta.url));
const migrationPath = fileURLToPath(
  new URL("../supabase/migrations/20260803000005_seed_rates.sql", import.meta.url),
);

const HEADER = `-- Migration 005 — seed the rates table (PLAN.md Part 4, CLAUDE.md rule 1).
--
-- GENERATED FILE — do not edit by hand.
-- Source of truth: config/rates/rps-2022.json
-- Regenerate:      pnpm rates:generate
--
-- ############################################################################
-- #  EVERY UNVERIFIED VALUE IN THIS FILE IS UNCONFIRMED.                     #
-- #                                                                          #
-- #  A row is confirmed only when source_go.verified is true in the JSON,    #
-- #  meaning a person opened that Government Order and checked the figure    #
-- #  and its effective date. Everything else came from public summaries.     #
-- #                                                                          #
-- #  payload->'_unverified' is true on every unconfirmed row. The            #
-- #  calculators read it and show a warning, so an unchecked rate cannot     #
-- #  quietly present itself as authoritative. Run pnpm rates:worksheet to    #
-- #  see what is left.                                                       #
-- ############################################################################
--
-- source_go stays null: it references documents(id), and the GOs may not be
-- ingested yet. The GO number travels in payload->'_source_go' so the admin can
-- link the row once the document exists.

-- Idempotent: re-running replaces the seed rather than duplicating it. Rows an
-- admin has since verified in the database are preserved.
delete from rates where payload ->> '_unverified' = 'true';
`;

/** Order the kinds appear in, so regenerating produces a stable diff. */
const KINDS = ["DA", "HRA", "MASTER_SCALE", "NPS", "IT_SLAB", "APGLI"];

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function build() {
  const rates = JSON.parse(readFileSync(configPath, "utf8"));
  const lines = [HEADER];

  for (const kind of KINDS) {
    const rows = rates[kind];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    lines.push(`\n-- ${kind}`);
    for (const row of rows) {
      const source = row.source_go ?? {};
      const verified = source.verified === true;
      const payload = {
        ...row.payload,
        // Only unconfirmed rows carry the flag, so the UI warning disappears
        // for a rate the moment it is verified in the JSON.
        ...(verified ? {} : { _unverified: true }),
        _source_go: {
          go_number: source.go_number ?? null,
          go_date: source.go_date ?? null,
          verified,
          note: source.note ?? null,
        },
      };
      const to = row.effective_to === null || row.effective_to === undefined
        ? "null"
        : `${sqlString(row.effective_to)}::date`;
      lines.push(
        "insert into rates (kind, effective_from, effective_to, payload, source_go) values",
      );
      lines.push(
        `  (${sqlString(kind)}, ${sqlString(row.effective_from)}::date, ${to}, ` +
          `${sqlString(JSON.stringify(payload))}::jsonb, null);`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

const generated = build();

if (process.argv.includes("--check")) {
  const current = readFileSync(migrationPath, "utf8");
  if (current !== generated) {
    console.error(
      "supabase/migrations/20260803000005_seed_rates.sql is out of date with\n" +
        "config/rates/rps-2022.json. The browser and the database would disagree\n" +
        "about a rate. Run: pnpm rates:generate",
    );
    process.exit(1);
  }
  console.log("rates seed is in step with the config.");
} else {
  writeFileSync(migrationPath, generated);
  const verified = Object.values(JSON.parse(readFileSync(configPath, "utf8")))
    .filter(Array.isArray)
    .flat()
    .filter((r) => r.source_go?.verified === true).length;
  const total = Object.values(JSON.parse(readFileSync(configPath, "utf8")))
    .filter(Array.isArray)
    .flat().length;
  console.log(`Regenerated the rates seed — ${verified}/${total} rows verified.`);
}

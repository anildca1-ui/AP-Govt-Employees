/**
 * Walks the unverified rates one at a time, asking a person to confirm each
 * against its Government Order.
 *
 *     pnpm rates:verify
 *
 * This is the last thing standing between the portal and being trustworthy, and
 * it is the one job no software can do: every rate here came from a public
 * summary, not from the order itself. Until somebody opens the GO and checks
 * the figure, each one shows a warning on the page.
 *
 * So the job is made as small as it can be — one rate at a time, the claim on
 * screen, the PDF link ready to open, and a yes/no answer. Work is saved after
 * every answer, so stopping halfway loses nothing, and the seed migration is
 * regenerated at the end so the database and the browser cannot disagree.
 *
 * Answering "yes" removes the warning from that rate. Nothing else does.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  describe,
  markCorrected,
  markVerified,
  pdfFor,
  unverifiedRows,
} from "./lib/rates-verify.mjs";

const ratesPath = fileURLToPath(new URL("../config/rates/rps-2022.json", import.meta.url));
const sourcesPath = fileURLToPath(new URL("../config/go-sources.json", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));

const sources = JSON.parse(readFileSync(sourcesPath, "utf8"));
let rates = JSON.parse(readFileSync(ratesPath, "utf8"));

const pending = unverifiedRows(rates);
const total = Object.values(rates).filter(Array.isArray).flat().length;

if (pending.length === 0) {
  console.log(`\nAll ${total} rates are confirmed against a GO. Nothing to do.\n`);
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log(`
Checking rates against their Government Orders
──────────────────────────────────────────────
${total - pending.length} of ${total} confirmed so far. ${pending.length} to go.

For each one: open the GO, find the figure, and answer.

  y  the GO says this          → the warning comes off this rate
  n  the GO says something else → you can type the right value
  s  skip for now              (just press Enter)
  q  stop and save

Nothing is marked confirmed unless you answer y.
`);

/**
 * The answers are recorded against a rate that is about to lose its warning, so
 * a value in the wrong field is worse than an annoying re-prompt. Both of these
 * refuse what cannot be right and ask again.
 *
 * This is not hypothetical: an end-to-end run where the answers were one step
 * out of sync silently wrote the GO date into the GO number field, the note
 * into the date, and the next rate's answer into the note — on a rate then
 * marked verified.
 */
async function askGoNumber() {
  for (;;) {
    const typed = (await rl.question("  Which GO number? (e.g. G.O.Ms.No.60) ")).trim();
    if (typed === "") return "";
    if (/\d/.test(typed) && !/^\d{4}-\d{2}-\d{2}$/.test(typed)) return typed;
    console.log("    That looks like a date, not a GO number. Try again, or Enter to skip.");
  }
}

async function askGoDate() {
  for (;;) {
    const typed = (await rl.question("  GO date (YYYY-MM-DD, or Enter to skip): ")).trim();
    if (typed === "") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(typed)) {
      console.log("    Needs to look like 2025-10-20. Try again, or Enter to skip.");
      continue;
    }
    if (Number.isNaN(new Date(`${typed}T00:00:00Z`).getTime())) {
      console.log("    Not a real date. Try again, or Enter to skip.");
      continue;
    }
    return typed;
  }
}

let confirmed = 0;
let corrected = 0;

for (const [position, { kind, index, row }] of pending.entries()) {
  const go = row.source_go?.go_number ?? null;
  const pdf = pdfFor(go, sources);

  console.log(`\n─── ${position + 1} of ${pending.length} ─────────────────────────────`);
  console.log(`  ${kind}`);
  console.log(`  ${describe(kind, row)}`);
  console.log(`  Government Order: ${go ?? "not identified — you will need to find it"}`);
  if (pdf !== null) console.log(`  PDF: ${pdf}`);
  if (row.source_go?.note) console.log(`  note: ${row.source_go.note}`);

  const answer = (await rl.question("\n  Does the GO say this? [y/n/s/q] ")).trim().toLowerCase();

  if (answer === "q") break;
  if (answer !== "y" && answer !== "n") continue;

  if (answer === "y") {
    // ?? and || cannot be mixed without parentheses, and the intent here is
    // "use the known number, else what they typed, else nothing".
    const typedGo = go === null ? await askGoNumber() : "";
    const goNumber = go ?? (typedGo === "" ? null : typedGo);
    const goDate = await askGoDate();
    const note = (await rl.question("  Anything worth noting? (Enter for none): ")).trim() || null;

    rates = markVerified(rates, kind, index, {
      checkedOn: today,
      ...(goNumber === null ? {} : { goNumber }),
      ...(goDate === null ? {} : { goDate }),
      ...(note === null ? {} : { note }),
    });
    confirmed += 1;
    console.log("  ✓ confirmed — the warning is off this rate");
  } else {
    // A correction is not a confirmation: the new figure is still one person's
    // transcription, so it keeps its warning until it is confirmed in turn.
    const field = typeof row.payload?.percent === "number" ? "percent" : null;
    if (field === null) {
      console.log("  This rate is not a single number — edit config/rates/rps-2022.json by hand.");
      continue;
    }
    const typed = (await rl.question(`  What does the GO actually say? (${field}) `)).trim();
    const value = Number(typed);
    if (!Number.isFinite(value)) {
      console.log("  Not a number — leaving this rate unchanged.");
      continue;
    }
    const note = (await rl.question("  Note (Enter for none): ")).trim() || null;
    rates = markCorrected(rates, kind, index, {
      checkedOn: today,
      correction: { [field]: value },
      ...(note === null ? {} : { note }),
    });
    corrected += 1;
    console.log("  ✓ corrected — it keeps its warning until someone confirms the new figure");
  }

  // Saved after every answer: stopping halfway must not lose the work.
  writeFileSync(ratesPath, `${JSON.stringify(rates, null, 2)}\n`);
}

rl.close();

if (confirmed === 0 && corrected === 0) {
  console.log("\nNothing changed.\n");
  process.exit(0);
}

// The browser reads the JSON and the server reads the seed migration. If they
// drift, the page and the database disagree about what an employee is owed.
console.log("\n── Rebuilding the database seed so it matches");
execSync("node scripts/generate-rates-seed.mjs", { cwd: root, stdio: "inherit" });

const left = unverifiedRows(rates).length;
console.log(`
Done. ${confirmed} confirmed, ${corrected} corrected — ${total - left} of ${total} now checked.

Commit the change so it is not lost:
  git add config/rates supabase/migrations && git commit -m "rates: verified against GOs"
`);

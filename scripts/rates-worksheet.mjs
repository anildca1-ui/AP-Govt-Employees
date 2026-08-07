/**
 * Prints the rate-verification worklist (PLAN.md Part 5, checkpoint 3).
 *
 *     pnpm rates:worksheet          # readable checklist
 *     pnpm rates:worksheet --csv    # for a spreadsheet
 *
 * Every figure in config/rates/rps-2022.json came from public summaries, not
 * from the Government Orders themselves, and each one becomes a rupee amount on
 * somebody's phone. This turns "check every rate" into a finite list of lines to
 * tick off, sorted so the ones that reach the most calculators come first.
 *
 * Marking a row verified means editing that file: set source_go.verified to true
 * and fill in go_number and go_date. The seed migration is regenerated from it,
 * and the on-screen warning disappears for that rate once it is true.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../config/rates/rps-2022.json", import.meta.url));
const rates = JSON.parse(readFileSync(path, "utf8"));
const csv = process.argv.includes("--csv");

/** Roughly how much of the site each kind feeds — drives the order to work in. */
const REACH = {
  DA: "13 calculators — every salary, arrears and pension figure",
  MASTER_SCALE: "pay fixation, increment, promotion",
  IT_SLAB: "income tax",
  HRA: "salary, full-pay figures",
  NPS: "NPS/CPS projections",
  APGLI: "APGLI/GPF",
};
const ORDER = ["DA", "MASTER_SCALE", "IT_SLAB", "HRA", "NPS", "APGLI"];

const rows = [];
for (const kind of ORDER) {
  for (const row of rates[kind] ?? []) {
    const p = row.payload ?? {};
    const value =
      p.percent !== undefined
        ? `${p.percent}%`
        : Object.keys(p).filter((k) => !k.startsWith("_")).join(", ") || "(structure)";
    rows.push({
      kind,
      from: row.effective_from,
      to: row.effective_to ?? "open",
      value,
      claimedGo: row.source_go?.go_number ?? "",
      verified: row.source_go?.verified === true,
      note: row.source_go?.note ?? "",
    });
  }
}

if (csv) {
  console.log("kind,effective_from,effective_to,value,claimed_go,verified,note");
  for (const r of rows) {
    console.log(
      [r.kind, r.from, r.to, r.value, r.claimedGo, r.verified, r.note]
        .map((f) => `"${String(f).replaceAll('"', '""')}"`)
        .join(","),
    );
  }
} else {
  const done = rows.filter((r) => r.verified).length;
  console.log(`\nRate verification — ${done}/${rows.length} confirmed against a GO\n`);
  let current = "";
  for (const r of rows) {
    if (r.kind !== current) {
      current = r.kind;
      console.log(`\n${r.kind}  ${REACH[r.kind] ?? ""}`);
      console.log("─".repeat(72));
    }
    const box = r.verified ? "[x]" : "[ ]";
    const period = `${r.from} → ${r.to}`.padEnd(24);
    const go = r.claimedGo === "" ? "GO unknown — find it" : r.claimedGo;
    console.log(`  ${box} ${period} ${String(r.value).padEnd(10)} ${go}`);
    if (r.note !== "" && r.note !== null) console.log(`        note: ${r.note}`);
  }
  console.log(
    "\nTo confirm one: open the GO, check the figure and the effective date, then in",
  );
  console.log("config/rates/rps-2022.json set that row's source_go.verified to true and");
  console.log("fill in go_number and go_date. The on-screen warning clears per rate.\n");
}

/**
 * A stand-in for PostgREST, just enough to render the database-backed pages.
 *
 * The real thing is a Haskell binary this sandbox cannot download, so the GO
 * library, the news feed and the per-GO pages have never been seen rendering.
 * supabase-js speaks plain HTTP, so this answers those requests directly.
 *
 * Every row is labelled SAMPLE on purpose: these screenshots must not be
 * mistakable for a loaded corpus. It renders layout, nothing more.
 */
import { createServer } from "node:http";

const MODE = process.argv[2] ?? "empty"; // "empty" | "data"

const iso = (d) => d;

const DOCS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    go_number: "G.O.Ms.No.60",
    go_type: "Ms",
    dept: "Finance",
    issue_date: iso("2025-10-20"),
    subject:
      "SAMPLE — Dearness Allowance to State Government Employees, enhanced from 33.67% to 37.31% of basic pay with effect from 1st January 2024",
    subject_te:
      "నమూనా — రాష్ట్ర ప్రభుత్వ ఉద్యోగులకు కరువు భత్యం 33.67% నుండి 37.31% కు పెంపు, 01-01-2024 నుండి అమలు",
    pdf_url: "https://example.invalid/sample-60.pdf",
    source: "sample",
    sha256: "sample-60",
    language: "en",
    is_scanned: false,
    status: "approved",
    superseded_by: null,
    supersedes: [],
    created_at: "2025-10-21T00:00:00Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    go_number: "G.O.Ms.No.28",
    go_type: "Ms",
    dept: "Finance",
    issue_date: iso("2024-03-15"),
    subject:
      "SAMPLE — Dearness Allowance revised from 22.75% to 26.39% of basic pay with effect from 1st July 2022",
    subject_te: "నమూనా — కరువు భత్యం 22.75% నుండి 26.39% కు సవరణ, 01-07-2022 నుండి",
    pdf_url: "https://example.invalid/sample-28.pdf",
    source: "sample",
    sha256: "sample-28",
    language: "en",
    is_scanned: false,
    // Superseded by the newer DA order, so the supersession chain has something
    // to draw and the "superseded" badge has something to mark.
    superseded_by: "11111111-1111-4111-8111-111111111111",
    supersedes: [],
    status: "approved",
    created_at: "2024-03-16T00:00:00Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    go_number: "G.O.Ms.No.101",
    go_type: "Ms",
    dept: "Finance",
    issue_date: iso("2022-05-11"),
    subject:
      "SAMPLE — Public Services, 11th Pay Revision Commission, Revised Pay Scales 2022, allowances and compensatory allowances",
    subject_te: "నమూనా — 11వ వేతన సవరణ సంఘం, సవరించిన పే స్కేళ్లు 2022, భత్యాలు",
    pdf_url: "https://example.invalid/sample-101.pdf",
    source: "sample",
    sha256: "sample-101",
    language: "en",
    is_scanned: false,
    superseded_by: null,
    supersedes: [],
    status: "approved",
    created_at: "2022-05-12T00:00:00Z",
  },
];

const RATES = [];

function rowsFor(path) {
  if (MODE === "empty") return [];
  if (path.startsWith("/rest/v1/documents")) return DOCS;
  if (path.startsWith("/rest/v1/rates")) return RATES;
  return [];
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let rows = rowsFor(url.pathname);

  // PostgREST filters live in the query string as column=op.value. Only the
  // filters these pages actually use are honoured; anything else passes through.
  for (const [key, raw] of url.searchParams) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    const [op, ...rest] = raw.split(".");
    const value = rest.join(".");
    if (op === "eq") rows = rows.filter((r) => String(r[key]) === value);
    if (op === "is" && value === "null") rows = rows.filter((r) => r[key] === null);
    if (op === "in") {
      const set = new Set(value.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")));
      rows = rows.filter((r) => set.has(String(r[key])));
    }
  }

  const single = (req.headers.accept ?? "").includes("vnd.pgrst.object");
  const body = single ? (rows[0] ?? null) : rows;

  res.writeHead(single && rows.length === 0 ? 406 : 200, {
    "content-type": "application/json; charset=utf-8",
    "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}`,
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
}).listen(54321, () => console.log(`stand-in PostgREST on :54321 (${MODE})`));

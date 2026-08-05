/**
 * Downloads the Government Orders listed in config/go-sources.json.
 *
 *     pnpm --filter @ap-emp-ai/ingest fetch:seeds
 *
 * A first load of the library that does not depend on driving goir.ap.gov.in's
 * search page, whose markup nobody has verified. These are direct links to the
 * PDFs; both routes end in the same review queue, and nothing is published
 * without an administrator approving it.
 *
 * The same politeness rules apply as to any crawl (CLAUDE.md rule 3): robots.txt
 * is honoured per origin, one request every two seconds, and the contact address
 * travels in the User-Agent. These are other people's servers.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadScraperConfig } from "../config.js";
import { RateLimiter } from "../politeness/rate-limiter.js";
import { RobotsGate } from "../politeness/robots.js";
import { IngestQueue } from "../queue/ingest-queue.js";
import { diagnose, reportFailure } from "./diagnose.js";

interface SeedDocument {
  url: string;
  claim?: string;
  topic?: string;
}

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

try {
  process.exitCode = await main();
} catch (error) {
  process.exitCode = reportFailure(diagnose(error, { url: "the listed sources", userAgent: "ap-emp-ai-bot" }));
  if (error instanceof Error && error.stack !== undefined) console.error(error.stack);
}

async function main(): Promise<number> {
  const config = loadScraperConfig();
  // readFile, not fetch: Node's fetch does not implement the file: scheme, and
  // the failure it produces is an opaque "fetch failed" that reads like the
  // network is down.
  const sourcesPath = fileURLToPath(new URL("../../../../config/go-sources.json", import.meta.url));
  const sources = JSON.parse(await readFile(sourcesPath, "utf8")) as {
    documents: SeedDocument[];
  };

  const documents = sources.documents ?? [];
  if (documents.length === 0) {
    console.log("config/go-sources.json lists no documents.");
    return 0;
  }

  const db: SupabaseClient = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
  const queue = new IngestQueue(db, "seed-list");

  const downloadDir = process.env.INGEST_DOWNLOAD_DIR ?? "./.ingest";
  await mkdir(downloadDir, { recursive: true });

  console.log(`User-Agent: ${config.userAgent}`);
  console.log(`${documents.length} document(s) listed\n`);

  const limiter = new RateLimiter({ minDelayMs: config.minDelayMs });
  // One gate per origin: robots.txt is per-site, and this list spans several.
  const gates = new Map<string, RobotsGate>();
  // Origins whose robots.txt could not be read. Cached so a site that is down
  // is asked once rather than once per document listed against it — eight
  // retries against an unreachable host is exactly the behaviour rule 3 exists
  // to prevent.
  const unreadable = new Map<string, string>();
  const counts = { queued: 0, duplicate: 0, blocked: 0, failed: 0 };

  for (const [index, document] of documents.entries()) {
    const progress = `[${index + 1}/${documents.length}]`;
    const label = document.claim ?? document.url;

    try {
      const origin = new URL(document.url).origin;

      const knownBad = unreadable.get(origin);
      if (knownBad !== undefined) {
        counts.failed += 1;
        console.log(`${progress} skipped — ${origin} robots.txt unreadable: ${knownBad}`);
        continue;
      }

      let gate = gates.get(origin);
      if (gate === undefined) {
        gate = new RobotsGate({ origin, contactEmail: config.contactEmail });
        await limiter.acquire();
        try {
          await gate.load();
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          unreadable.set(origin, reason.replace(/^Could not read \S+ \(?/, "").replace(/\)\.?\s*Refusing.*$/, ""));
          counts.failed += 1;
          console.log(`${progress} ${reason}`);
          continue;
        }
        gates.set(origin, gate);
      }

      if (!gate.isAllowed(document.url)) {
        counts.blocked += 1;
        console.log(`${progress} robots.txt disallows ${document.url} — skipped`);
        continue;
      }

      await limiter.acquire();
      const response = await fetch(document.url, {
        headers: { "User-Agent": config.userAgent },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        counts.failed += 1;
        console.log(`${progress} HTTP ${response.status} — ${document.url}`);
        continue;
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!looksLikePdf(bytes)) {
        // A login wall or an error page served with a 200 is the usual cause.
        counts.failed += 1;
        console.log(`${progress} not a PDF (${bytes.byteLength} bytes) — ${document.url}`);
        continue;
      }

      const filePath = join(downloadDir, fileNameFor(document.url));
      await writeFile(filePath, bytes);

      // Metadata is deliberately left empty apart from the URL. What the search
      // engine said is a hint for the reviewer, not a fact about the document —
      // the extractor reads the real values out of the PDF, and an
      // administrator confirms them before anything is published.
      const outcome = await queue.enqueue({
        entry: {
          goNumber: "",
          goType: null,
          department: "",
          issueDate: "",
          subject: document.claim ?? "",
          pdfUrl: document.url,
        },
        pdf: bytes,
        filePath,
      });

      if (outcome.status === "queued") {
        counts.queued += 1;
        console.log(`${progress} queued — ${label}`);
      } else {
        counts.duplicate += 1;
        console.log(`${progress} already known (${outcome.where}) — ${label}`);
      }
    } catch (error) {
      counts.failed += 1;
      console.log(
        `${progress} failed — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(
    `\nQueued ${counts.queued}, already had ${counts.duplicate}, ` +
      `${counts.blocked} blocked by robots.txt, ${counts.failed} failed.`,
  );
  if (counts.queued > 0) {
    console.log("\nNext: approve them at /admin, then make them searchable with");
    console.log("  pnpm --filter @ap-emp-ai/ingest index:documents");
  }
  return counts.queued === 0 && counts.failed > 0 ? 1 : 0;
}

function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

function fileNameFor(url: string): string {
  const base = new URL(url).pathname.split("/").pop() ?? "document.pdf";
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set — see SETUP.md step 2.`);
  }
  return value;
}

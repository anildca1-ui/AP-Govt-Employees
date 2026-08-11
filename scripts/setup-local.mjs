/**
 * Runs the whole database on this machine — no account, no cloud, no keys to
 * copy anywhere.
 *
 *     pnpm setup:local
 *
 * `supabase start` brings up Postgres with pgvector, the API layer, auth and
 * storage in Docker, applies every migration, and prints its keys. This reads
 * those keys straight out of that output and writes .env, so the local path has
 * no manual copying at all — which is the whole difference between "free
 * alternative" and "free alternative a non-programmer can actually reach".
 *
 * What it does NOT do is make the site public: this database lives on this
 * computer and is reachable only from it. That is the right way to build and
 * check everything, and the wrong way to serve AP employees — for that the
 * database has to be somewhere that is awake when the owner's PC is not.
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildEnv } from "./lib/env-file.mjs";
import { parseSupabaseEnv, parseSupabaseStart } from "./lib/supabase-status.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const examplePath = fileURLToPath(new URL("../.env.example", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));

console.log("Starting the local database. The first run downloads several\n" +
  "hundred MB and can take a few minutes — progress appears below.\n");

// Inherited, not captured: this takes minutes, and a captured stream means a
// silent terminal, which reads as a hung command. The keys are read from
// `status` afterwards instead — same summary block, and it returns at once.
let started = true;
try {
  execSync("pnpm exec supabase start", { cwd: root, stdio: "inherit" });
} catch {
  // Already-running is not a failure; `status` below tells us which it was.
  started = false;
}

// --output env first: plain KEY="value" lines, no colour, no table layout.
// Parsing the pretty output failed twice on a real machine; the CLI is allowed
// to restyle it and does.
let keys = null;
try {
  keys = parseSupabaseEnv(
    execSync("pnpm exec supabase status --output env", { cwd: root, encoding: "utf8" }),
  );
} catch {
  keys = null;
}

const incomplete = (k) => k === null || k.url === null || k.anon === null || k.service === null;

// Only when that failed. `start` has already printed this block once, and
// printing it again — which it used to, unconditionally — buries the result
// under a second screen of tables the reader has just scrolled past.
if (incomplete(keys)) {
  let output = "";
  try {
    output = execSync("pnpm exec supabase status", { cwd: root, encoding: "utf8" });
    process.stdout.write(`\n${output}`);
  } catch {
    console.error(
      "\nCould not start the local database.\n\n" +
        "The usual cause is Docker Desktop not being open. This needs it running:\n" +
        "start Docker Desktop, wait until it says it is running, then try again.\n\n" +
        (started ? "" : "The start command also reported a problem — its output is above.\n"),
    );
    process.exit(1);
  }
  keys = parseSupabaseStart(output);
}

const missing = ["url", "anon", "service"].filter((name) => keys[name] === null);
if (missing.length > 0) {
  // Say what was actually seen. Twice now this failed with nothing to go on but
  // "could not be read", which cost a round trip each time to find out what the
  // CLI had really printed.
  let sample = "";
  try {
    sample = execSync("pnpm exec supabase status --output env", {
      cwd: root,
      encoding: "utf8",
    });
  } catch {
    // Older CLIs have no --output env; the message below still tells them what
    // to run by hand.
  }

  console.error(
    `\nThe database is running, but its keys could not be read (missing: ` +
      `${missing.join(", ")}).\n\n` +
      `Nothing is broken and no data is lost. Two ways forward:\n\n` +
      `  1. Run this, and paste what it prints:\n` +
      `       pnpm exec supabase status --output env\n\n` +
      `  2. Or set the values by hand from that output:\n` +
      `       pnpm setup:env\n` +
      (sample === "" ? "" : `\nWhat this script saw:\n${sample}\n`),
  );
  process.exit(1);
}

if (existsSync(envPath)) {
  console.log("\n.env already exists — leaving it alone. Its values are:");
  console.log(`  NEXT_PUBLIC_SUPABASE_URL=${keys.url}`);
  console.log("  (run pnpm setup:env if you want to rewrite it)\n");
} else {
  writeFileSync(
    envPath,
    buildEnv(readFileSync(examplePath, "utf8"), {
      NEXT_PUBLIC_SUPABASE_URL: keys.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.anon,
      SUPABASE_SERVICE_ROLE_KEY: keys.service,
      ADMIN_TOKEN: randomBytes(24).toString("base64url"),
    }),
  );
  const adminToken = /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync(envPath, "utf8"))?.[1] ?? "";
  console.log(`
✓ Wrote .env — the site is now pointed at the database on this computer.

  Admin password (for the /admin page): ${adminToken}
  Save it somewhere safe.
`);
}

console.log(`Next:
  pnpm dev              start the site
  ${keys.studio ?? "http://127.0.0.1:54323"}   look inside the database in your browser
  pnpm db:stop          stop the database when you are done
`);

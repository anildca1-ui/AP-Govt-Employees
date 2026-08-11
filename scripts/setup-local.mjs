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
import { buildEnv, parseSupabaseStart } from "./lib/env-file.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const examplePath = fileURLToPath(new URL("../.env.example", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));

console.log("Starting the local database (this takes a few minutes the first time)...\n");

let output;
try {
  output = execSync("pnpm exec supabase start", {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  process.stdout.write(output);
} catch (error) {
  // Already running is not a failure — ask it for the same summary instead.
  try {
    output = execSync("pnpm exec supabase status", { cwd: root, encoding: "utf8" });
    process.stdout.write(output);
  } catch {
    console.error(
      "\nCould not start the local database.\n\n" +
        "The usual cause is Docker Desktop not running — this needs it, and it\n" +
        "must be open before this command works. Start Docker Desktop, wait for\n" +
        "it to say it is running, then try again.\n\n" +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

const keys = parseSupabaseStart(output);
const missing = ["url", "anon", "service"].filter((name) => keys[name] === null);
if (missing.length > 0) {
  console.error(
    `\nThe database started, but its keys could not be read from the output\n` +
      `(missing: ${missing.join(", ")}).\n\n` +
      `Nothing is broken — run this to see them, then use pnpm setup:env:\n` +
      `  pnpm exec supabase status\n`,
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

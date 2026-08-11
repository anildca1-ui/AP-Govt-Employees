/**
 * Writes .env by asking for the values only a person can fetch.
 *
 *     pnpm setup:env
 *
 * The alternative is "copy .env.example to .env, open it in a text editor, and
 * paste each value next to the right name" — which is four chances to paste
 * into the wrong line, leave a stray space, or wrap a key in quotes, and every
 * one of those failures shows up much later as an unhelpful connection error.
 *
 * This asks for the three Supabase values by the name they have on Supabase's
 * own screen, invents the admin password itself (nobody should have to think
 * one up, and a weak one is the whole security of /admin), and leaves every
 * other setting exactly as .env.example has it.
 *
 * It never overwrites an existing .env without being told to: that file holds
 * keys the owner may not be able to recover.
 */
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildEnv, clean, warningsFor } from "./lib/env-file.mjs";

const examplePath = fileURLToPath(new URL("../.env.example", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function ask(question, { required = true } = {}) {
  for (;;) {
    const answer = clean(await rl.question(question));
    if (answer !== "" || !required) return answer;
    console.log("  (needed — paste the value, or press Ctrl+C to stop)");
  }
}

console.log(`
Setting up .env
───────────────
Open your Supabase project, then: Project Settings → API.
Three values are on that page. Paste each one when asked.
`);

if (existsSync(envPath)) {
  const overwrite = clean(
    await rl.question(".env already exists. Replace it? Its keys will be lost. (y/N) "),
  );
  if (overwrite.toLowerCase() !== "y") {
    console.log("Left alone. Nothing changed.");
    rl.close();
    process.exit(0);
  }
}

const url = await ask('Project URL (starts with https://):\n  ');
const anon = await ask('anon public key (a long string):\n  ');
const service = await ask('service_role key (a different long string):\n  ');

rl.close();

// Generated, not chosen: this is the entire protection on /admin, where GOs are
// approved. A memorable password here is a stranger approving documents.
const adminToken = randomBytes(24).toString("base64url");

const replacements = {
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
  SUPABASE_SERVICE_ROLE_KEY: service,
  ADMIN_TOKEN: adminToken,
};

writeFileSync(envPath, buildEnv(readFileSync(examplePath, "utf8"), replacements));

const warnings = warningsFor({ url, anon, service });

console.log(`
✓ Wrote .env

  Admin password (for the /admin page): ${adminToken}

  Save that somewhere safe now — it is not shown again, and it is what
  protects the page where Government Orders get approved.
`);

for (const warning of warnings) console.log(`⚠️  ${warning}\n`);

console.log("Next:  pnpm setup:check");

/**
 * Tells you, in plain language, what part of the portal is ready to run.
 *
 *     pnpm setup:check
 *
 * The portal works in stages. The calculators need no setup at all; the GO
 * library needs a database; the AI chat needs a model key. So this reports
 * stage by stage rather than as one pass/fail, because "not everything is
 * configured" is not the same as "nothing works" — you can launch with the
 * first two stages and add the rest later.
 *
 * Where it can, it checks the thing rather than the setting: a database URL
 * that is filled in but unreachable is worse than one that is blank, because
 * blank is honest.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Reads .env without a dependency. Values already in the environment win. */
function loadEnv() {
  const env = { ...process.env };
  const path = join(root, ".env");
  if (!existsSync(path)) return { env, hasFile: false };

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined && process.env[key] !== "") continue;
    env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
  return { env, hasFile: true };
}

const { env, hasFile } = loadEnv();
const set = (name) => typeof env[name] === "string" && env[name].trim() !== "";

const GREEN = "[32m";
const YELLOW = "[33m";
const DIM = "[2m";
const BOLD = "[1m";
const RESET = "[0m";

/** Can we actually reach Supabase, and has the schema been applied? */
async function checkSupabase() {
  if (!set("NEXT_PUBLIC_SUPABASE_URL") || !set("NEXT_PUBLIC_SUPABASE_ANON_KEY")) return null;

  const url = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    const response = await fetch(`${url}/rest/v1/rates?select=kind&limit=1`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) return "no-schema";
    if (response.status === 401 || response.status === 403) return "bad-key";
    if (!response.ok) return "error";
    return "ok";
  } catch {
    return "unreachable";
  }
}

const stages = [
  {
    name: "Calculators (13 of them)",
    what: "Salary, DA arrears, pension, gratuity, income tax and the rest.",
    needs: [],
    note: "These run entirely in the visitor's phone, so they work with no setup at all.",
  },
  {
    name: "GO library, news and the review queue",
    what: "The searchable library of Government Orders, and the admin page where you approve them.",
    needs: [
      ["NEXT_PUBLIC_SUPABASE_URL", "your Supabase project URL"],
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "the Supabase 'anon' key"],
      ["SUPABASE_SERVICE_ROLE_KEY", "the Supabase 'service_role' key — keep this secret"],
      ["ADMIN_TOKEN", "a password you invent, to protect the admin page"],
    ],
  },
  {
    name: "AI chat",
    what: "Answering questions in Telugu and English, citing the GO each answer comes from.",
    needs: [
      ["GEMINI_API_KEY", "a Google AI Studio key"],
      [
        ["OPENAI_API_KEY", "DEEPINFRA_API_KEY"],
        "an embedding key — OpenAI or DeepInfra, whichever you prefer",
      ],
    ],
  },
  {
    name: "Collecting GOs automatically",
    what: "The nightly job that fetches new Government Orders into the review queue.",
    needs: [
      ["SCRAPER_CONTACT_EMAIL", "a real email address you monitor — government sites see it"],
      ["CRON_SECRET", "a password you invent, so only the scheduler can start a crawl"],
    ],
  },
  {
    name: "Telegram bot",
    what: "Optional. Answers questions in Telegram and accepts forwarded GO PDFs.",
    optional: true,
    needs: [
      ["TELEGRAM_BOT_TOKEN", "from @BotFather in Telegram"],
      ["TELEGRAM_WEBHOOK_SECRET", "a password you invent"],
    ],
  },
  {
    name: "WhatsApp bot",
    what: "Optional. The same, over WhatsApp.",
    optional: true,
    needs: [
      ["WHATSAPP_PHONE_NUMBER_ID", "from the Meta developer console"],
      ["WHATSAPP_ACCESS_TOKEN", "from the Meta developer console"],
      ["WHATSAPP_VERIFY_TOKEN", "a password you invent"],
      ["WHATSAPP_APP_SECRET", "from the Meta developer console"],
    ],
  },
  {
    name: "Error alerts",
    what: "Optional. Tells you when something breaks, instead of you finding out from a user.",
    optional: true,
    needs: [["NEXT_PUBLIC_SENTRY_DSN", "from sentry.io"]],
  },
];

function missingFor(stage) {
  const missing = [];
  for (const [name, description] of stage.needs) {
    const names = Array.isArray(name) ? name : [name];
    if (!names.some(set)) missing.push([names.join(" or "), description]);
  }
  return missing;
}

console.log(`\n${BOLD}What is ready${RESET}`);
console.log(
  hasFile
    ? `${DIM}Read from your .env file.${RESET}\n`
    : `${DIM}No .env file yet — copy .env.example to .env and fill it in as you go.${RESET}\n`,
);

let firstBlocked = null;

for (const stage of stages) {
  const missing = missingFor(stage);
  const ready = missing.length === 0;
  const mark = ready ? `${GREEN}ready${RESET}` : `${YELLOW}not yet${RESET}`;

  console.log(`${BOLD}${stage.name}${RESET} — ${mark}`);
  console.log(`  ${stage.what}`);
  if (stage.note !== undefined) console.log(`  ${DIM}${stage.note}${RESET}`);

  for (const [name, description] of missing) {
    console.log(`  ${YELLOW}need${RESET} ${name} ${DIM}— ${description}${RESET}`);
  }
  if (!ready && !stage.optional && firstBlocked === null) firstBlocked = stage;
  console.log("");
}

const supabase = await checkSupabase();
if (supabase !== null) {
  console.log(`${BOLD}Database${RESET}`);
  const messages = {
    ok: `${GREEN}connected, and the tables are in place${RESET}`,
    "no-schema": `${YELLOW}connected, but the tables are missing — run the setup SQL (step 3 in SETUP.md)${RESET}`,
    "bad-key": `${YELLOW}reachable, but the key was rejected — re-copy it from Supabase${RESET}`,
    unreachable: `${YELLOW}could not be reached — check the project URL${RESET}`,
    error: `${YELLOW}responded with an error — check the project is not paused${RESET}`,
  };
  console.log(`  ${messages[supabase]}\n`);
}

console.log(`${BOLD}Next${RESET}`);

if (firstBlocked !== null) {
  console.log(`  Work on: ${BOLD}${firstBlocked.name}${RESET}`);
  console.log(`  SETUP.md walks through it step by step.\n`);
} else if (supabase !== null && supabase !== "ok") {
  // Every setting is filled in, but the database did not answer. Saying
  // "everything is configured" here would be technically true and practically
  // wrong — the portal will not serve a single Government Order like this.
  const fix = {
    "no-schema": "Run the six SQL files in supabase/migrations, in order (SETUP.md step 3).",
    "bad-key": "Re-copy the anon key from Supabase → Project Settings → API.",
    unreachable: "Check NEXT_PUBLIC_SUPABASE_URL, and that the project is not paused.",
    error: "Open the Supabase dashboard — a free project pauses after inactivity.",
  };
  console.log(`  ${YELLOW}Settings are all filled in, but the database did not answer.${RESET}`);
  console.log(`  ${fix[supabase]}\n`);
} else {
  console.log(`  ${GREEN}Everything required is configured.${RESET} Deploy, then fill the library:`);
  console.log("    pnpm --filter @ap-emp-ai/ingest verify:selectors   (check the GO site first)");
  console.log("    pnpm --filter @ap-emp-ai/ingest scrape:goir        (collect GOs)");
  console.log("  Then approve them at /admin and they appear in the library.\n");
}

/**
 * One command to get the latest work and run the site.
 *
 *     pnpm go
 *
 * The portal is developed on another machine and arrives here through Git, so
 * "look at the newest version" was four commands in the right order — pull,
 * install, build the shared packages, start — with a fifth (setup:local) if the
 * settings file was not filled in yet. Every one of them was a chance to run
 * the wrong one, or the right one in the wrong order, and several of the
 * failures in this project's history were exactly that.
 *
 * Each step says what it is doing in plain words, and when something fails it
 * says what to do rather than printing a stack trace. Nothing here is clever;
 * it is the same commands, in the order that works, so there is only one thing
 * to remember.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readEnv } from "./lib/env-file.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));

const run = (command, options = {}) =>
  execSync(command, { cwd: root, stdio: "inherit", ...options });

const quiet = (command) => execSync(command, { cwd: root, encoding: "utf8" }).trim();

function step(message) {
  console.log(`\n── ${message}`);
}

function give_up(what, advice) {
  console.error(`\n✗ ${what}\n\n${advice}\n`);
  process.exit(1);
}

// ── 1. The latest work ──────────────────────────────────────────────────────
step("Getting the latest version");
try {
  // Local edits would make the pull fail with a merge message that means
  // nothing to someone who has not edited anything. Say so plainly instead.
  const dirty = quiet("git status --porcelain");
  if (dirty !== "") {
    console.log("  (you have local changes — keeping them, and pulling on top)");
  }
  run("git pull --rebase --autostash");
} catch {
  give_up(
    "Could not get the latest version.",
    "Usually this is the internet being down. If it mentions a conflict, say so\n" +
      "and it can be sorted out — nothing is lost.",
  );
}

// ── 2. Dependencies ─────────────────────────────────────────────────────────
step("Checking the project's parts are installed");
try {
  run("pnpm install --prefer-offline");
} catch {
  give_up(
    "Could not install the project's parts.",
    "Check the internet connection and run `pnpm go` again.",
  );
}

// ── 3. The shared calculation code ──────────────────────────────────────────
// Not optional: the calculators import it, it is not stored in Git, and without
// it every calculator page fails with "Module not found".
step("Building the shared calculation code");
try {
  run("node scripts/build-packages.mjs");
} catch {
  give_up("The shared code did not build.", "The error above says why.");
}

// ── 4. Settings ─────────────────────────────────────────────────────────────
const SUPABASE_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const env = existsSync(envPath) ? readEnv(readFileSync(envPath, "utf8")) : new Map();
const unset = SUPABASE_KEYS.filter((name) => (env.get(name) ?? "") === "");

if (unset.length > 0) {
  step("Setting up the database connection");
  console.log("  (the library, admin queue and sign-in need this; calculators do not)");
  try {
    run("node scripts/setup-local.mjs");
  } catch {
    console.log(
      "\n  Could not set it up automatically — the site will still start, and\n" +
        "  the calculators will work. To fix it later:\n" +
        "    • start Docker Desktop, then run: pnpm setup:local\n" +
        "    • or, for a cloud database:        pnpm setup:env\n",
    );
  }
}

// ── 5. Run it ───────────────────────────────────────────────────────────────
step("Starting the site — leave this window open");
console.log("  Open the address printed below. Ctrl+C here stops the site.\n");
try {
  run("pnpm --filter @ap-emp-ai/web dev");
} catch {
  // Ctrl+C lands here too, and that is not a failure.
  process.exit(0);
}

#!/usr/bin/env node
/**
 * A stand-in for the Supabase CLI, so scripts/setup-local.mjs can be run end to
 * end without Docker.
 *
 * This exists because three attempts to read the local stack's keys were tested
 * only at the parser, never by running the script — and each one failed on a
 * real machine for a reason a real run would have caught immediately. It emits
 * the shapes actually observed, including the ANSI colour inside table cells.
 *
 * STUB_MODE picks the CLI being imitated:
 *   modern    (default) --output env works
 *   old       no --output env; only the coloured table
 *   nodocker  every command fails, as when Docker Desktop is closed
 */
const args = process.argv.slice(2);
const ESC = String.fromCharCode(27);
const MODE = process.env.STUB_MODE || "modern";

if (args[0] === "start") {
  if (MODE === "nodocker") { console.error("failed to connect to docker daemon"); process.exit(1); }
  console.log("Started supabase local development setup.");
  process.exit(0);
}
if (args[0] === "status") {
  const wantsEnv = args.includes("--output") && args[args.indexOf("--output") + 1] === "env";
  if (wantsEnv) {
    if (MODE === "old") { console.error("unknown flag: --output"); process.exit(1); }
    if (MODE === "nodocker") { console.error("not running"); process.exit(1); }
    console.log('API_URL="http://127.0.0.1:54321"');
    console.log('ANON_KEY="sb_publishable_STUBSTUBSTUB"');
    console.log('SERVICE_ROLE_KEY="sb_secret_STUBSTUBSTUB"');
    console.log('DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"');
    console.log('STUDIO_URL="http://127.0.0.1:54323"');
    process.exit(0);
  }
  if (MODE === "nodocker") { console.error("not running"); process.exit(1); }
  // Coloured table, exactly the shape that defeated the earlier parser.
  console.log(`| ${ESC}[1mStudio${ESC}[0m | http://127.0.0.1:54323 |`);
  console.log(`| ${ESC}[1mProject URL${ESC}[0m | http://127.0.0.1:54321 |`);
  console.log(`| ${ESC}[1mPublishable${ESC}[0m | sb_publishable_STUBSTUBSTUB |`);
  console.log(`| ${ESC}[1mSecret${ESC}[0m | sb_secret_STUBSTUBSTUB |`);
  process.exit(0);
}
process.exit(0);

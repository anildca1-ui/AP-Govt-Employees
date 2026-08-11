/**
 * Builds the workspace packages the web app imports, and proves they are there.
 *
 *   node scripts/build-packages.mjs
 *
 * apps/web imports @ap-emp-ai/calc and @ap-emp-ai/rag, whose package.json
 * points at ./dist — build output that .gitignore excludes. Without it, every
 * calculator page fails with "Module not found: Can't resolve
 * '@ap-emp-ai/calc'", which is what a fresh clone hits.
 *
 * Why this is a script and not a filter in package.json: `pnpm --filter
 * "./packages/*" build` selects packages by directory glob, and a glob that
 * matches nothing is not an error — pnpm builds zero packages and exits 0. On
 * the machine where the filter matches, dev works; on the machine where it does
 * not, dev starts anyway and fails later with a module error that says nothing
 * about the real cause. That is precisely how this survived one round of
 * fixing: the filter form was verified on Linux and still built nothing on
 * Windows.
 *
 * So this filters by package NAME, which does not depend on how a platform
 * writes paths, and then checks that each dist/index.js actually exists. A
 * build that silently produces nothing fails loudly here instead of becoming a
 * confusing error in the browser three minutes later.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Every workspace package with a build, in the order pnpm should consider. */
const PACKAGES = ["calc", "rag", "ingest"];

const root = fileURLToPath(new URL("..", import.meta.url));
const filters = PACKAGES.map((name) => `--filter @ap-emp-ai/${name}`).join(" ");

try {
  // One command so pnpm orders them by dependency. shell:true is implied by
  // execSync, which is what lets `pnpm` resolve through PATH on Windows too.
  execSync(`pnpm ${filters} build`, { cwd: root, stdio: "inherit" });
} catch {
  console.error("\nThe workspace packages failed to build. The output above says why.");
  process.exit(1);
}

const missing = PACKAGES.filter(
  (name) => !existsSync(fileURLToPath(new URL(`../packages/${name}/dist/index.js`, import.meta.url))),
);

if (missing.length > 0) {
  console.error(
    `\nBuild reported success but produced nothing for: ${missing.join(", ")}.\n\n` +
      `The site cannot run without these — every calculator page would fail with\n` +
      `"Module not found: Can't resolve '@ap-emp-ai/calc'".\n\n` +
      `Try building one directly to see the real error:\n` +
      `  pnpm --filter @ap-emp-ai/${missing[0]} build\n`,
  );
  process.exit(1);
}

console.log(`✓ workspace packages built: ${PACKAGES.join(", ")}`);

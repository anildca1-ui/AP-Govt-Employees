import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The web app imports @ap-emp-ai/calc and @ap-emp-ai/rag, whose package.json
 * points at ./dist — build output, which .gitignore excludes. So a fresh clone
 * has no dist, and any script that starts the app without building the
 * workspace packages first fails with "Module not found: Can't resolve
 * '@ap-emp-ai/calc'".
 *
 * That is exactly what happened on the owner's PC: the site loaded, and every
 * calculator page answered 500. It never showed up here because this machine
 * had dist left over from earlier builds — the defect is invisible to anyone
 * who has already run the project once, which is everyone who could have
 * caught it.
 *
 * The first fix used `pnpm --filter "./packages/*" build`, and that was not
 * enough: a directory glob that matches nothing is not an error, so on Windows
 * it built zero packages, exited 0, and dev started into the same module error.
 * The build now goes through scripts/build-packages.mjs, which filters by
 * package NAME and then checks each dist/index.js exists.
 *
 * This pins the three scripts to that builder, because the failure mode is
 * silent for the person making the change and total for the person cloning.
 */
const scripts = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../../package.json", import.meta.url)), "utf8"),
  ) as { scripts: Record<string, string> }
).scripts;

describe("root scripts build the workspace packages before using them", () => {
  it.each(["dev", "test", "typecheck"])("%s builds the packages first", (name) => {
    const script = scripts[name];
    expect(script, `${name} is missing from package.json`).toBeDefined();
    // The verifying builder specifically — a bare pnpm --filter can match
    // nothing and pass, which is the bug this exists to prevent.
    expect(script).toMatch(/node\s+scripts\/build-packages\.mjs/);
  });

  it("build compiles the whole workspace, packages included", () => {
    // pnpm -r build runs every package's build in dependency order, so the
    // web app's build always has dist to import from.
    expect(scripts.build).toMatch(/pnpm\s+-r\s+build/);
  });
});

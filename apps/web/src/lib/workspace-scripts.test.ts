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
 * `test` and `typecheck` already built first; `dev` did not. This pins all
 * three, because the failure mode is silent for the person making the change
 * and total for the person cloning.
 */
const scripts = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../../package.json", import.meta.url)), "utf8"),
  ) as { scripts: Record<string, string> }
).scripts;

describe("root scripts build the workspace packages before using them", () => {
  it.each(["dev", "test", "typecheck"])("%s builds packages/* first", (name) => {
    const script = scripts[name];
    expect(script, `${name} is missing from package.json`).toBeDefined();
    expect(script).toMatch(/--filter\s+"?\.\/packages\/\*"?\s+build/);
  });

  it("build compiles the whole workspace, packages included", () => {
    // pnpm -r build runs every package's build in dependency order, so the
    // web app's build always has dist to import from.
    expect(scripts.build).toMatch(/pnpm\s+-r\s+build/);
  });
});

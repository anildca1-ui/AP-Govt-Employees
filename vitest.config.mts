import { defineConfig } from "vitest/config";

// Single root runner for the whole monorepo: `pnpm test` at the root is the
// definition-of-done gate (CLAUDE.md rule 8), so every package's tests must be
// reachable from here without per-package config files.
export default defineConfig({
  test: {
    projects: ["packages/*"],
  },
});

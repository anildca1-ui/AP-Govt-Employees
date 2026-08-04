import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest needs the "@/" alias spelled out.
 *
 * Next resolves it from tsconfig paths, but Vitest does not read those, so a
 * test importing "@/i18n/dictionary" fails to resolve even though the same
 * import works in the app. Kept in sync with apps/web/tsconfig.json.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/next-env.d.ts",
      "supabase/.temp/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Workspace packages, build scripts and root tooling run on Node.
  {
    files: [
      "packages/**/*.ts",
      "apps/*/scripts/**/*.{mjs,mts,ts}",
      "apps/*/*.{mjs,mts,ts}",
      "*.{mjs,mts,ts}",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Next.js app: core-web-vitals plus the hooks rules.
  {
    ...nextPlugin.flatConfig.coreWebVitals,
    files: ["apps/web/**/*.{ts,tsx}"],
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Pages Router only. This app is App Router, and the rule reports a
      // "Pages directory cannot be found" warning on every run without it.
      "@next/next/no-html-link-for-pages": "off",
    },
    languageOptions: {
      globals: { ...globals.browser, React: "readonly" },
    },
  },

  // Tests may lean on expect(...) shapes that trip the unsafe-argument style
  // rules; keep the signal on source code.
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);

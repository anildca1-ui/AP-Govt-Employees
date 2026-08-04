import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship compiled ESM from dist/, so Next can consume them
  // directly. Listed here so a future package that ships raw TS still works.
  transpilePackages: ["@ap-emp-ai/calc", "@ap-emp-ai/rag"],
};

/**
 * Source-map upload is applied only when the credentials for it exist.
 *
 * withSentryConfig without them warns on every build and gains nothing, so a
 * checkout with no error tracker configured — a fork, CI, a local dev run —
 * builds exactly as it did before. Set SENTRY_ORG, SENTRY_PROJECT and
 * SENTRY_AUTH_TOKEN at deploy time to get readable stack traces rather than
 * minified ones.
 */
const org = process.env.SENTRY_ORG;
const project = process.env.SENTRY_PROJECT;
const authToken = process.env.SENTRY_AUTH_TOKEN;

export default org && project && authToken
  ? withSentryConfig(nextConfig, {
      org,
      project,
      authToken,
      silent: true,
      // Uploaded for Sentry, then deleted, so the deployed bundle does not ship
      // a map that de-minifies it for everyone.
      sourcemaps: { deleteSourcemapsAfterUpload: true },
    })
  : nextConfig;

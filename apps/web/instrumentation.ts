import type { Instrumentation } from "next";

/**
 * Server and edge error reporting (TASKS.md Phase 6.4).
 *
 * Sentry starts only when a DSN is configured. Without one this file registers
 * nothing and onRequestError falls through to the console, which is what the
 * app did before — so a fork with no error tracker, a local dev run and CI all
 * behave exactly as they did.
 */
export async function register(): Promise<void> {
  const { sentryDsn, sentryOptions } = await import("@/lib/observability/sentry-options");
  const dsn = sentryDsn();
  if (dsn === undefined) return;

  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init(sentryOptions(dsn));
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { sentryDsn } = await import("@/lib/observability/sentry-options");

  if (sentryDsn() === undefined) {
    // The pre-existing behaviour: structured, server-side, and no further than
    // the host's log. Path only — a query string can carry a prefilled pay.
    console.error("[request-error]", {
      path: request.path,
      router: context.routerKind,
      route: context.routePath,
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(error, request, context);
};

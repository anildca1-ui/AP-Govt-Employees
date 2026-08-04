import { sentryDsn, sentryOptions } from "@/lib/observability/sentry-options";

/**
 * Browser error reporting.
 *
 * The import is dynamic and behind the DSN check on purpose. A static
 * `import * as Sentry` here costs about 83 kB of First Load JS on every page
 * whether or not an error tracker is configured — measured, not guessed — and
 * this site is aimed at government employees on phones with a Lighthouse ≥90
 * mobile target (PLAN.md Phase 6.3). NEXT_PUBLIC_SENTRY_DSN is inlined at build
 * time, so with no DSN the branch is dead code and the SDK never enters the
 * initial bundle; with one, it loads as a separate chunk after hydration.
 *
 * Session Replay is deliberately not enabled: it would record somebody typing
 * their basic pay into a calculator.
 *
 * No onRouterTransitionStart export — that hook exists to mark navigation
 * spans, and tracesSampleRate is 0 because an ordinary request here carries a
 * question about somebody's own service record.
 */
const dsn = sentryDsn();

if (dsn !== undefined) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init(sentryOptions(dsn));
  });
}

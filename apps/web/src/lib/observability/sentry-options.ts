import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { scrubEvent } from "./scrub";

/**
 * One Sentry configuration, shared by the server, edge and browser entrypoints.
 *
 * Kept in a plain module rather than repeated three times so the privacy
 * settings cannot drift apart — the browser config is the easiest of the three
 * to forget, and it is the one that sees the form fields.
 *
 * Everything is inert without a DSN: no DSN means Sentry.init is never called,
 * so a developer, a CI run, or anyone self-hosting without an error tracker gets
 * exactly the behaviour they had before this existed.
 */

export function sentryDsn(): string | undefined {
  // The browser can only read NEXT_PUBLIC_; the server prefers the private one
  // and falls back so a single variable configures both if that is all you set.
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
  return dsn === undefined || dsn === "" ? undefined : dsn;
}

export function sentryOptions(dsn: string) {
  return {
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,

    // Off by default in the SDK, set explicitly because it is the single switch
    // that decides whether IP addresses, cookies and headers get attached.
    sendDefaultPii: false,

    // Errors only. Performance tracing samples ordinary requests, and an
    // ordinary request here carries a question somebody asked about their own
    // service record — worth revisiting only with sampling that excludes /chat.
    tracesSampleRate: 0,

    // Belt and braces: sendDefaultPii covers what the SDK adds on purpose, this
    // covers what an integration or a future upgrade adds by accident.
    beforeSend: (event: ErrorEvent) => scrubEvent(event),
    beforeBreadcrumb: (crumb: Breadcrumb) => {
      const [scrubbed] = scrubEvent({ breadcrumbs: [crumb] }).breadcrumbs;
      return scrubbed ?? crumb;
    },
  };
}

/**
 * What a reader is told when their question fails.
 *
 * The server's error text is written for whoever runs the site —
 * "NEXT_PUBLIC_SUPABASE_URL is not set", "Too many requests", "Question is
 * longer than 2000 characters" — and the chat used to render it verbatim in the
 * answer bubble. On a Telugu-first site that meant an employee asking about
 * their DA read an English environment-variable name as the answer to their
 * question, which is both a leak of how the site is wired and a rule 5 breach on
 * the most visible AI surface. It is also the first thing the owner would see if
 * a variable were missing on their first deploy.
 *
 * So the status code decides which message is shown and the dictionary supplies
 * it. Server prose never reaches the page; it stays in the server log, where it
 * is actually useful.
 */
import type { Dictionary } from "@/i18n/dictionary";

/**
 * Kept here rather than imported from ./service: that module pulls in the whole
 * RAG package at module scope, and this value is needed by a client component.
 */
export const MAX_QUESTION_CHARS = 2000;

/**
 * Used when a 429 arrives with no usable Retry-After. Matches CHAT_LIMIT's
 * window, so the advice is never shorter than the wait actually is — telling
 * someone to retry sooner than they can just earns them a second refusal.
 */
export const FALLBACK_RETRY_SECONDS = 5 * 60;

export type ChatFailure =
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "generic" };

export function classifyFailure(status: number, retryAfterHeader: string | null): ChatFailure {
  if (status !== 429) return { kind: "generic" };

  const parsed = Number(retryAfterHeader);
  // A missing, negative or non-numeric header must not become "try again in
  // NaN seconds"; the header is set by us today but is not worth trusting.
  const seconds =
    Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : FALLBACK_RETRY_SECONDS;
  return { kind: "rate-limited", retryAfterSeconds: seconds };
}

/** Seconds under a minute, whole minutes above — "300 సెకన్ల" helps nobody. */
export function formatWait(seconds: number, dict: Dictionary): string {
  if (seconds < 60) return dict.chat.waitSeconds.replace("{n}", String(seconds));
  return dict.chat.waitMinutes.replace("{n}", String(Math.ceil(seconds / 60)));
}

export function failureMessage(failure: ChatFailure, dict: Dictionary): string {
  if (failure.kind === "rate-limited") {
    return dict.chat.errorRateLimited.replace(
      "{wait}",
      formatWait(failure.retryAfterSeconds, dict),
    );
  }
  return dict.chat.error;
}

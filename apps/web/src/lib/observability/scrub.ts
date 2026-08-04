/**
 * Strips personal data out of an error report before it leaves the server.
 *
 * Error tracking is the one place a privacy posture quietly comes undone: the
 * default for every SDK is to attach as much context as it can find, and on this
 * site that context is a phone number, a basic pay figure, or the question
 * somebody asked the chatbot about their own service record. None of that is
 * needed to fix a stack trace, and sending it would make the error tracker a
 * processor of personal data under DPDP — a second copy of the thing /privacy
 * promises we keep in one place.
 *
 * So this is deny-by-default: the request body, cookies and headers go entirely,
 * and only an allow-list of query parameters survives. Adding a field to the
 * allow-list should feel like a decision, which is the point.
 */

/** Query parameters that carry nothing about a person. */
const SAFE_QUERY_PARAMS = new Set(["locale", "page", "kind", "dept", "year", "fy", "q_len"]);

interface ScrubbableRequest {
  url?: string;
  data?: unknown;
  cookies?: unknown;
  headers?: Record<string, string> | undefined;
  query_string?: unknown;
}

export interface ScrubbableEvent {
  request?: ScrubbableRequest;
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: { data?: Record<string, unknown>; message?: string }[];
}

/** Header names worth keeping: they describe the request, not the requester. */
const SAFE_HEADERS = new Set(["content-type", "accept-language", "user-agent"]);

const REDACTED = "[redacted]";

export function scrubUrl(rawUrl: string): string {
  // Nothing to redact without a query string, and parsing would only normalise
  // the input into something the reader did not send.
  if (!rawUrl.includes("?")) return rawUrl;

  let url: URL;
  try {
    url = new URL(rawUrl, "https://placeholder.invalid");
  } catch {
    return rawUrl;
  }

  for (const key of [...url.searchParams.keys()]) {
    if (!SAFE_QUERY_PARAMS.has(key)) url.searchParams.set(key, REDACTED);
  }
  // searchParams percent-encodes the marker; a person reading the error should
  // see [redacted], not %5Bredacted%5D.
  const search = url.search.replaceAll("%5B" + "redacted" + "%5D", REDACTED);

  // A GO id is part of the path and is public data, so paths are kept as-is.
  return rawUrl.startsWith("http")
    ? `${url.origin}${url.pathname}${search}`
    : `${url.pathname}${search}`;
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request !== undefined) {
    const request = event.request;

    // The body is where a chat question, a phone number and a basic pay figure
    // all live. There is no version of it worth keeping.
    delete request.data;
    delete request.cookies;
    delete request.query_string;

    if (typeof request.url === "string") request.url = scrubUrl(request.url);

    if (request.headers !== undefined) {
      const kept: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (SAFE_HEADERS.has(name.toLowerCase())) kept[name] = value;
      }
      request.headers = kept;
    }
  }

  // Sentry attaches a user when it can infer one. An id would be pseudonymous
  // at best and is not needed to read a stack trace.
  delete event.user;

  // Breadcrumbs replay the request path, including fetch URLs with parameters.
  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      if (typeof crumb.message === "string") crumb.message = redactDigits(crumb.message);
      if (crumb.data !== undefined) {
        for (const [key, value] of Object.entries(crumb.data)) {
          if (typeof value === "string") {
            crumb.data[key] = key.toLowerCase().includes("url")
              ? scrubUrl(value)
              : redactDigits(value);
          }
        }
      }
    }
  }

  return event;
}

/**
 * Masks long digit runs — phone numbers and pay figures — while leaving short
 * ones alone, so "HTTP 500" and "G.O.Ms.No.60" still read normally.
 */
function redactDigits(text: string): string {
  return text.replace(/\d{5,}/g, "[redacted]");
}

/**
 * Turns a scraper failure into something the person running it can act on.
 *
 * The verifier is the first thing anyone runs against a live government site,
 * usually from a laptop behind whatever network their office has. Its failures
 * are almost never bugs — they are "you cannot reach the site", "the site is
 * refusing this bot", or "Playwright has no browser installed" — and each has a
 * different next step. An unhandled rejection with a stack trace tells the
 * reader none of that and looks like the tool is broken.
 */

export interface Diagnosis {
  /** One line: what went wrong. */
  summary: string;
  /** What to do about it, in order. */
  nextSteps: string[];
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function diagnose(error: unknown, context: { url: string; userAgent: string }): Diagnosis {
  const message = messageOf(error);
  const { url, userAgent } = context;
  const origin = safeOrigin(url);

  // Node's fetch collapses DNS failure, refused connections and TLS problems
  // into one opaque "fetch failed", so they share a diagnosis.
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|certificate/i.test(message)) {
    return {
      summary: `Could not reach ${origin} from this machine.`,
      nextSteps: [
        `Check the site loads in a browser here: ${origin}`,
        "If you are on a VPN, a corporate proxy or a sandboxed environment, the request may never leave the network.",
        `Confirm from the command line: curl -sI -A "${userAgent}" ${origin}/robots.txt`,
      ],
    };
  }

  const status = /HTTP (\d{3})/.exec(message)?.[1];

  if (status === "403" || status === "401") {
    return {
      summary: `${origin} refused the request (HTTP ${status}).`,
      nextSteps: [
        "Two very different causes, worth telling apart before changing anything:",
        `  · the site is blocking this User-Agent — try: curl -sI -A "${userAgent}" ${origin}/robots.txt`,
        "  · something between you and it (proxy, firewall, WAF) is blocking — try the same URL in a browser on this machine.",
        "If the site itself is blocking the bot, do not disguise the User-Agent. Contact the site with the address in it (CLAUDE.md rule 3) and ask for access.",
      ],
    };
  }

  if (status === "429") {
    return {
      summary: `${origin} is rate-limiting us (HTTP 429).`,
      nextSteps: [
        "Wait before retrying — the site is explicitly asking for less traffic.",
        "If this recurs at one request per two seconds, raise SCRAPER_MIN_DELAY_MS rather than retrying harder.",
      ],
    };
  }

  if (status !== undefined && status.startsWith("5")) {
    return {
      summary: `${origin} returned a server error (HTTP ${status}).`,
      nextSteps: [
        "This is the site's problem, not the selectors'. Try again later.",
        "Refusing to crawl on a failed robots.txt is deliberate: a site that is already struggling is the last one to hammer.",
      ],
    };
  }

  if (/Executable doesn't exist|browserType\.launch|playwright install/i.test(message)) {
    return {
      summary: "Playwright has no browser installed.",
      nextSteps: [
        "Install one: npx playwright install chromium",
        "Or point at an existing binary with PLAYWRIGHT_BROWSERS_PATH.",
      ],
    };
  }

  if (/SCRAPER_CONTACT_EMAIL/.test(message)) {
    return {
      summary: message,
      nextSteps: [
        "Set SCRAPER_CONTACT_EMAIL in .env to a real, monitored address.",
        "It is sent to every government site we touch, and it is how an administrator reaches us instead of banning us.",
      ],
    };
  }

  return {
    summary: message,
    nextSteps: [
      `This one is not a known failure mode. The full error follows; the selectors live in src/goir/selectors.ts if it turns out to be a markup change.`,
    ],
  };
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** Prints a diagnosis to stderr and returns the exit code to use. */
export function reportFailure(diagnosis: Diagnosis): number {
  console.error(`\n✗ ${diagnosis.summary}\n`);
  for (const step of diagnosis.nextSteps) console.error(`  ${step}`);
  console.error("");
  return 1;
}

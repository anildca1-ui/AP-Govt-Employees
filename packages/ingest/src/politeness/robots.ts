import robotsParserImport from "robots-parser";
import { buildUserAgent, PRODUCT_TOKEN } from "./user-agent.js";

/**
 * robots-parser is CommonJS (`module.exports = fn`), so Node's ESM interop hands
 * us the function as the default export — but its shipped .d.ts opens with
 * `declare module 'robots-parser';`, which types the whole module as untyped and
 * leaves the default not callable. The shape is asserted here, once, rather than
 * scattering casts through the class below.
 */
interface Robot {
  isAllowed(url: string, ua?: string): boolean | undefined;
  isDisallowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
  getSitemaps(): string[];
}

const robotsParser = robotsParserImport as unknown as (url: string, contents: string) => Robot;

/**
 * robots.txt gate (CLAUDE.md rule 3).
 *
 * Matching rules — group selection, longest-match-wins, wildcards, Crawl-delay —
 * are subtle enough that a hand-rolled parser gets them quietly wrong, and
 * "quietly wrong" here means crawling paths we were asked not to. So this wraps
 * robots-parser rather than reimplementing it.
 *
 * Fetch failures are deliberately NOT treated as "allowed". A site that is down,
 * rate-limiting us, or returning 500 is the last one to hammer.
 */

export interface RobotsGateOptions {
  origin: string;
  contactEmail: string;
  fetchImpl?: typeof fetch;
}

export class RobotsGate {
  readonly origin: string;
  readonly userAgent: string;
  #fetch: typeof fetch;
  #robot: Robot | null = null;
  #loaded = false;

  constructor({ origin, contactEmail, fetchImpl = fetch }: RobotsGateOptions) {
    this.origin = new URL(origin).origin;
    this.userAgent = buildUserAgent(contactEmail);
    this.#fetch = fetchImpl;
  }

  async load(): Promise<void> {
    const robotsUrl = `${this.origin}/robots.txt`;
    const response = await this.#fetch(robotsUrl, {
      headers: { "User-Agent": this.userAgent },
    });

    if (response.status === 404) {
      // No robots.txt means no restrictions — the one case where absence is
      // genuinely permission.
      this.#robot = null;
      this.#loaded = true;
      return;
    }

    if (!response.ok) {
      throw new Error(
        `Could not read ${robotsUrl} (HTTP ${response.status}). Refusing to crawl ` +
          `without knowing what is disallowed.`,
      );
    }

    this.#robot = robotsParser(robotsUrl, await response.text());
    this.#loaded = true;
  }

  /** Throws if load() has not run — never silently defaults to permitted. */
  isAllowed(url: string): boolean {
    if (!this.#loaded) {
      throw new Error("RobotsGate.load() must be awaited before checking a URL");
    }
    if (this.#robot === null) return true;
    // Matched on the product token, not the full header — see PRODUCT_TOKEN.
    return this.#robot.isAllowed(url, PRODUCT_TOKEN) ?? true;
  }

  /**
   * Crawl-delay from robots.txt, in ms, when the site asks for a slower rate than
   * our own floor. We take whichever is slower — the site's wishes never make us
   * faster than rule 3's 1-request-per-2s.
   */
  crawlDelayMs(): number | null {
    if (!this.#loaded || this.#robot === null) return null;
    const seconds = this.#robot.getCrawlDelay(PRODUCT_TOKEN);
    return typeof seconds === "number" ? seconds * 1000 : null;
  }
}

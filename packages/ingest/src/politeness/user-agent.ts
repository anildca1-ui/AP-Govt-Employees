/**
 * The User-Agent every request to a government site carries (CLAUDE.md rule 3).
 *
 * The contact address is not decoration: it is how an administrator at
 * goir.ap.gov.in reaches us if our crawler misbehaves, and being reachable is
 * the price of being allowed to crawl at all. A scraper with no working contact
 * address is one that gets IP-banned instead of emailed. So this throws rather
 * than falling back to a default — a run with no contact address must not start.
 */

/**
 * The product token. robots.txt group matching is defined against this bare
 * token, not against the full User-Agent header — a `User-agent: ap-emp-ai-bot`
 * group would silently fail to match if we handed a matcher the whole
 * "ap-emp-ai-bot (contact: ...)" string.
 */
export const PRODUCT_TOKEN = "ap-emp-ai-bot";

const PRODUCT = PRODUCT_TOKEN;

/** Addresses that mean "nobody filled this in yet". */
const PLACEHOLDER_PATTERNS = [
  /^$/,
  /example\.(com|org|net|invalid)$/i,
  /^<.*>$/,
  /^(unset|todo|changeme|your-?email)/i,
];

export class MissingContactEmailError extends Error {
  constructor(reason: string) {
    super(
      `Refusing to scrape: SCRAPER_CONTACT_EMAIL ${reason}. ` +
        `Set it to a real, monitored address — it is sent in the User-Agent on every ` +
        `request to a government site (CLAUDE.md hard rule 3).`,
    );
    this.name = "MissingContactEmailError";
  }
}

export function buildUserAgent(contactEmail: string | undefined): string {
  if (contactEmail === undefined) throw new MissingContactEmailError("is not set");

  const email = contactEmail.trim();

  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(email))) {
    throw new MissingContactEmailError(`is still a placeholder (${email || "empty"})`);
  }
  // Deliberately loose: the point is to catch "not an address at all", not to
  // adjudicate RFC 5322.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new MissingContactEmailError(`is not an email address (${email})`);
  }

  return `${PRODUCT} (contact: ${email})`;
}

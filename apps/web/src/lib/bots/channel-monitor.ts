/**
 * Telegram channel monitor (PLAN.md Phase 4, Part 2.1).
 *
 * Scope, deliberately: this watches channels and groups where OUR bot has been
 * added — Part 2.1's option (a), "your own bot added as admin to YOUR
 * aggregator channel/group where users post GOs". The Bot API delivers those
 * posts as ordinary updates, so no user session and no scraping is involved,
 * which is what makes it ToS-safe.
 *
 * Part 2.1's option (b) — joining and reading arbitrary public channels — is
 * NOT implemented. It needs a Telethon user session, which means a Python
 * worker outside this stack and a user account acting as a crawler. That is a
 * different risk profile from a bot posting under its own identity, and it is
 * not worth taking for a source that mostly re-posts documents the scrapers
 * and the forward inbox already reach. If it is ever added it belongs in
 * packages/ocr-worker alongside the other Python, read-only and rate-limited.
 */

/**
 * Channel ids or @usernames we accept posts from, from the environment.
 *
 * Takes a plain string map rather than NodeJS.ProcessEnv: that interface
 * declares no properties, so a narrower literal type has "nothing in common"
 * with it, while a literal cannot satisfy its index signature under
 * exactOptionalPropertyTypes. A Record satisfies both directions.
 */
export function allowedChannels(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const raw = env.TELEGRAM_MONITOR_CHANNELS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * Whether a channel post should be ingested.
 *
 * An allow-list rather than "anything the bot can see": someone can add a bot
 * to any channel, and without this a stranger could point a channel full of
 * junk at the review queue and bury the real documents. An empty list accepts
 * nothing, so forgetting to configure it fails closed.
 */
export function isMonitoredChannel(
  chat: { id: number; username?: string | undefined },
  allowed: string[],
): boolean {
  if (allowed.length === 0) return false;

  const id = String(chat.id);
  const username = chat.username === undefined ? null : `@${chat.username}`.toLowerCase();

  return allowed.some((entry) => {
    const normalised = entry.toLowerCase();
    return normalised === id || (username !== null && normalised === username);
  });
}

/** ingest_queue.source for a monitored channel, e.g. "telegram-channel:@ap_gos". */
export function channelSource(chat: { id: number; username?: string | undefined }): string {
  return `telegram-channel:${chat.username === undefined ? chat.id : `@${chat.username}`}`;
}

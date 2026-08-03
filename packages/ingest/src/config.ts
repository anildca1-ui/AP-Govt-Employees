import { buildUserAgent } from "./politeness/user-agent.js";

/**
 * Scraper configuration, read from the environment described in `.env.example`.
 *
 * Validation happens here rather than at the first request, so a misconfigured
 * run fails before it touches a government server.
 */
export interface ScraperConfig {
  contactEmail: string;
  userAgent: string;
  /** Politeness floor: 1 request per 2s (CLAUDE.md rule 3). */
  minDelayMs: number;
  downloadDir: string;
}

/** Rule 3's floor. Config may slow the crawler down, never speed it up. */
export const MIN_DELAY_FLOOR_MS = 2000;

export function loadScraperConfig(env: NodeJS.ProcessEnv = process.env): ScraperConfig {
  const contactEmail = env.SCRAPER_CONTACT_EMAIL;
  // Throws with an actionable message when unset or still a placeholder.
  const userAgent = buildUserAgent(contactEmail);

  const configured = Number(env.SCRAPER_MIN_DELAY_MS ?? MIN_DELAY_FLOOR_MS);
  const requested = Number.isFinite(configured) ? configured : MIN_DELAY_FLOOR_MS;

  return {
    contactEmail: (contactEmail ?? "").trim(),
    userAgent,
    // A lower value in .env is a mistake, not an instruction.
    minDelayMs: Math.max(MIN_DELAY_FLOOR_MS, requested),
    downloadDir: env.INGEST_DOWNLOAD_DIR ?? ".downloads",
  };
}

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

export function loadSupabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — ingestion writes to ingest_queue, " +
        "which RLS exposes to the service role only.",
    );
  }

  return { url, serviceRoleKey };
}

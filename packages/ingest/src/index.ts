export { sha256Hex } from "./dedupe.js";

export {
  loadScraperConfig,
  loadSupabaseConfig,
  MIN_DELAY_FLOOR_MS,
  type ScraperConfig,
  type SupabaseConfig,
} from "./config.js";

export {
  buildUserAgent,
  MissingContactEmailError,
  PRODUCT_TOKEN,
} from "./politeness/user-agent.js";
export { RateLimiter, type RateLimiterOptions } from "./politeness/rate-limiter.js";
export { RobotsGate, type RobotsGateOptions } from "./politeness/robots.js";

export {
  parseGoNumber,
  parseIndexRows,
  parseIssueDate,
  withinLastDays,
  type ParseOptions,
} from "./goir/parse.js";
export {
  defaultSelectors,
  GOIR_BASE_URL,
  type GoirSelectors,
} from "./goir/selectors.js";
export { extractRows, scrapeGoir, type ScrapeOptions, type ScrapeSummary } from "./goir/scrape.js";
export type {
  GoIndexEntry,
  GoType,
  ParseResult,
  RawIndexRow,
  SkippedRow,
} from "./goir/types.js";

export { IngestQueue, type EnqueueInput, type EnqueueOutcome } from "./queue/ingest-queue.js";

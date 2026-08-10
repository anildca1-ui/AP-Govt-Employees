import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  calculateDaArrears,
  formatINR,
  InvalidPeriodError,
  RateNotFoundError,
  type RateRow,
} from "@ap-emp-ai/calc";
import type { Citation, RetrievalDb } from "@ap-emp-ai/rag";
import { prepareChat, validateQuestion } from "@/lib/chat/service";
import { RATES } from "@/lib/calculators/rates-data";
import { BOT_ANSWER_LIMIT, BOT_UPLOAD_LIMIT, rateLimit } from "@/lib/rate-limit";

/**
 * Logic shared by the Telegram and WhatsApp bots (PLAN.md Phase 4).
 *
 * Both answer the same questions from the same corpus under the same rules, so
 * both go through this rather than each reimplementing retrieval, citation
 * formatting and the disclaimer. A bot that answered differently from the
 * website would be a second, unaudited product.
 */

export const BOT_ANSWER_CHANNELS = ["telegram", "whatsapp"] as const;
export type BotChannel = (typeof BOT_ANSWER_CHANNELS)[number];

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * The shared secret a bot webhook authenticates callers with, or a refusal.
 *
 * Both webhooks are public URLs whose only caller check is this secret. Treating
 * an unset one as "skip the check" would mean a missing environment variable
 * silently converts an authenticated endpoint into an open one — and the failure
 * is invisible, because the bot keeps working perfectly for real traffic while
 * accepting forged traffic too. A forged update can queue attacker-supplied
 * PDFs, spend model budget, and make our own bot send messages to recipients an
 * attacker picks.
 *
 * So it fails closed, the same way the scraper refuses to run without a contact
 * address (CLAUDE.md rule 3). "is not set" in the message is what the route
 * handlers match on to answer 500 rather than 200.
 */
export function requiredWebhookSecret(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set — refusing to accept unauthenticated webhook calls. ` +
        `It is the only thing distinguishing a real update from a forged one.`,
    );
  }
  return value;
}

/**
 * Per-sender throttling for the bots.
 *
 * Keyed on who sent the message, never on the request's IP. Every webhook call
 * arrives from Meta's or Telegram's servers, so an IP key would put every user
 * of the bot in one bucket — one spammer would then exhaust the budget for
 * everyone, which is worse than not limiting at all.
 *
 * Refusals stay silent after the first one in the window. Replying to every
 * refused message would make our own number the amplifier: an attacker sends a
 * thousand messages and we send a thousand back, paying for each and burning
 * the number's standing with Meta.
 */
export type BotAction = "ask" | "upload";

export interface ThrottleDecision {
  allowed: boolean;
  /** What to send back, or null to stay silent because we already said it. */
  notice: string | null;
}

export function botThrottle(
  channel: BotChannel,
  action: BotAction,
  sender: string,
  now: number = Date.now(),
): ThrottleDecision {
  const limit = action === "upload" ? BOT_UPLOAD_LIMIT : BOT_ANSWER_LIMIT;
  const decision = rateLimit(`${channel}:${action}:${sender}`, { ...limit, now });
  if (decision.allowed) return { allowed: true, notice: null };

  const shouldWarn = rateLimit(`${channel}:notice:${action}:${sender}`, {
    limit: 1,
    windowMs: limit.windowMs,
    now,
  }).allowed;

  const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
  return {
    allowed: false,
    notice: shouldWarn
      ? `⏳ కొంచెం ఆగండి — ${minutes} నిమిషాల తర్వాత మళ్ళీ ప్రయత్నించండి. / ` +
        `Too many messages just now — please try again in about ${minutes} minute(s).`
      : null,
  };
}

/** Anon key: retrieval reads approved documents only, and RLS enforces that. */
export function botRetrievalClient(): RetrievalDb {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false } },
  ) as unknown as RetrievalDb;
}

/** Service role: ingest_queue and chat_logs are service-role only under RLS. */
export function botServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function embedForBot(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    // The third embedding call site, and the one the OPENAI_BASE_URL override
    // missed: chat's and ingest's were made overridable and this stayed
    // hardcoded, so a proxy or regional deployment would have worked on the
    // website and silently not on the bots.
    const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const response = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.EMBEDDING_MODEL ?? "text-embedding-3-large",
        input: text,
        dimensions: 1024,
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: { embedding: number[] }[] };
    return payload.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

/**
 * Renders citations for a chat surface with no HTML.
 *
 * The GO number, date and link are all present, because rule 1's requirement
 * is that the reader can open the order and check it — that does not weaken
 * because the answer arrived over WhatsApp.
 */
export function formatCitations(citations: Citation[]): string {
  if (citations.length === 0) return "";

  const lines = citations.map((citation) => {
    const parts = [citation.goNumber ?? "GO"];
    if (citation.issueDate !== null) parts.push(`dt ${toGoDate(citation.issueDate)}`);
    const head = parts.join(", ");
    const superseded = citation.supersededBy === null ? "" : " (superseded)";
    const link = citation.pdfUrl === null ? "" : `\n  ${citation.pdfUrl}`;
    return `• ${head}${superseded}${link}`;
  });

  return `\n\nSources:\n${lines.join("\n")}`;
}

function toGoDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return isoDate;
  const [, y, m, d] = match;
  return `${d}.${m}.${y}`;
}

export interface BotAnswer {
  text: string;
  citations: Citation[];
}

/**
 * Answers a question for a bot.
 *
 * The stream is collected into one message rather than sent progressively:
 * chat platforms rate-limit message edits aggressively, and a half-written
 * government rule is worse than a short wait.
 */
export async function answerForBot(question: string): Promise<BotAnswer> {
  const asked = validateQuestion(question);

  const { citations, stream } = await prepareChat(
    {
      db: botRetrievalClient(),
      embed: embedForBot,
      apiKey: requiredEnv("GEMINI_API_KEY"),
      ...(process.env.LLM_MODEL !== undefined && { model: process.env.LLM_MODEL }),
    },
    { question: asked },
  );

  let answer = "";
  for await (const token of stream) answer += token;

  return { text: `${answer}${formatCitations(citations)}`, citations };
}

export async function logBotChat(
  channel: BotChannel,
  session: string,
  question: string,
  answer: string,
  citations: Citation[],
): Promise<void> {
  const db = botServiceClient();
  if (db === null) return;
  try {
    await db.from("chat_logs").insert({
      session,
      question,
      answer,
      cited_docs: citations.map((c) => c.documentId),
      channel,
    });
  } catch {
    // Never surface a logging failure to someone waiting on an answer.
  }
}

/**
 * The /da command: a quick arrears figure without leaving the chat.
 *
 * Deliberately narrow. It reports the total and points at the web calculator
 * for the month-wise table, rather than trying to reproduce a table in a chat
 * bubble where it would be unreadable and unverifiable.
 */
export function daCommand(args: string[], siteUrl: string | null): string {
  const basicPay = Number(args[0]);
  const paidDa = Number(args[1]);
  const fromMonth = args[2];
  const toMonth = args[3];

  if (!Number.isFinite(basicPay) || basicPay <= 0) {
    return (
      "Usage: /da <basic pay> <DA % already paid> <from YYYY-MM> <to YYYY-MM>\n" +
      "Example: /da 52590 33.67 2024-01 2025-09"
    );
  }
  if (!Number.isFinite(paidDa) || fromMonth === undefined || toMonth === undefined) {
    return "Usage: /da <basic pay> <DA % already paid> <from YYYY-MM> <to YYYY-MM>";
  }

  try {
    const result = calculateDaArrears(
      { basicPay, fromMonth, toMonth, paidDaPercent: paidDa },
      RATES as RateRow<{ percent: number }>[],
    );

    const source = result.sourceGos.length > 0 ? `\nAs per ${result.sourceGos.join(", ")}` : "";
    const warning = result.unverified
      ? "\n\n⚠️ These rates have not yet been verified against the GO."
      : "";

    // The link rides along only when the public address is known. The old
    // fallback pointed at a domain nobody on this project is known to hold —
    // a reply with no link beats a reply linking a stranger's server.
    const table =
      siteUrl === null ? "" : `\nMonth-wise table: ${siteUrl}/te/calculators/da-arrears`;
    return (
      `DA arrears for ${result.months.length} month(s)\n` +
      `Basic pay: ${formatINR(basicPay)}\n` +
      `Total: ${formatINR(result.total)}${source}${table}${warning}`
    );
  } catch (error) {
    // The catch used to return any error's message verbatim, so a fault of ours
    // answered a /da command with its own diagnostics. Each case now gets what
    // its reader can act on.

    // Says what the sender typed wrong — "Bad month: xyz", "2025-06 is after
    // 2024-01" — which is exactly what they need.
    if (error instanceof InvalidPeriodError) return error.message;

    // Real, and the sender's business, but its message ends with "seed or
    // verify the row before calculating" — instructions for whoever runs the
    // site, not for someone asking about their arrears.
    if (error instanceof RateNotFoundError) {
      const where =
        siteUrl === null
          ? ""
          : `\nCovered periods are listed at ${siteUrl}/te/calculators/da-arrears`;
      return `No DA rate is on record for that period yet.${where}`;
    }

    console.error("[bots] /da failed:", error);
    return "Could not calculate. Please check the values and try again.";
  }
}

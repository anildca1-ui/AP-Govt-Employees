import { Bot, webhookCallback } from "grammy";
import {
  answerForBot,
  botServiceClient,
  botThrottle,
  daCommand,
  logBotChat,
  requiredEnv,
  requiredWebhookSecret,
} from "@/lib/bots/shared";
import { intakeForwardedPdf, intakeReply, MAX_PDF_BYTES } from "@/lib/bots/ingest";
import {
  allowedChannels,
  channelSource,
  isMonitoredChannel,
} from "@/lib/bots/channel-monitor";

/**
 * Telegram webhook (PLAN.md Phase 4).
 *
 * Bot API via grammY, as the stack specifies. The bot answers questions from
 * the same corpus under the same rules as the website, runs /da, and accepts
 * forwarded GOs into the review queue.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HELP = [
  "AP Employees Portal",
  "",
  "/ask <question> — an answer grounded in the GOs, with citations",
  "/da <basic> <paid DA %> <from YYYY-MM> <to YYYY-MM> — DA arrears",
  "",
  "📤 Forward any GO PDF here and it will be queued for the library.",
  "",
  "ఏ ప్రశ్ననైనా నేరుగా తెలుగులో అడగవచ్చు.",
].join("\n");

/**
 * Built once per warm instance. grammy's webhookCallback is generic over its
 * adapter, so the "std/http" shape is stated explicitly rather than inferred —
 * ReturnType<typeof webhookCallback> resolves to the union of every adapter.
 */
type WebhookHandler = (request: Request) => Promise<Response>;

let cached: WebhookHandler | null = null;

function buildBot() {
  const bot = new Bot(requiredEnv("TELEGRAM_BOT_TOKEN"));
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ap-emp-ai.in";

  // Ahead of every handler, so nothing that costs money or review attention
  // runs first. A valid secret token proves the update came through Telegram,
  // not that the person behind it is being reasonable.
  bot.use(async (ctx, next) => {
    // Channel posts come from the allow-listed channels the monitor watches,
    // not from the public; the allow-list is the limit there, and throttling by
    // chat would drop GOs a busy channel posts in a burst.
    if (ctx.channelPost !== undefined) return next();

    const sender = ctx.from?.id;
    if (sender === undefined) return next();

    const action = ctx.message?.document === undefined ? "ask" : "upload";
    const throttle = botThrottle("telegram", action, String(sender));
    if (throttle.allowed) return next();
    if (throttle.notice !== null) await ctx.reply(throttle.notice);
  });

  bot.command("start", (ctx) => ctx.reply(HELP));
  bot.command("help", (ctx) => ctx.reply(HELP));

  bot.command("da", (ctx) => {
    const args = (ctx.match ?? "").trim().split(/\s+/).filter(Boolean);
    return ctx.reply(daCommand(args, siteUrl));
  });

  bot.command("ask", async (ctx) => {
    const question = (ctx.match ?? "").trim();
    if (question === "") return ctx.reply("Ask me something: /ask What is the current DA?");
    await respond(ctx, question);
  });

  // Documents first: a forwarded GO is a contribution, not a question.
  bot.on("message:document", async (ctx) => {
    const document = ctx.message.document;

    if ((document.file_size ?? 0) > MAX_PDF_BYTES) {
      return ctx.reply("Sorry — that file is too large to accept.");
    }

    const db = botServiceClient();
    if (db === null) return ctx.reply("Sorry — document intake is not configured yet.");

    try {
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${requiredEnv("TELEGRAM_BOT_TOKEN")}/${file.file_path}`;
      const response = await fetch(url);
      if (!response.ok) return ctx.reply("Sorry — the file could not be downloaded.");

      const bytes = new Uint8Array(await response.arrayBuffer());
      const outcome = await intakeForwardedPdf(db, {
        bytes,
        fileName: document.file_name ?? null,
        mimeType: document.mime_type ?? null,
        from: String(ctx.from?.id ?? "unknown"),
        source: "telegram",
      });

      return ctx.reply(intakeReply(outcome));
    } catch {
      return ctx.reply("Sorry — the document could not be processed. Please try again.");
    }
  });

  // Read-only channel monitor: a GO posted to a channel our bot has been added
  // to is queued silently. No reply — a bot answering into a channel of a few
  // thousand people every time someone posts a file is noise, and the sender is
  // not asking us anything.
  bot.on("channel_post:document", async (ctx) => {
    const allowed = allowedChannels();
    if (!isMonitoredChannel(ctx.chat, allowed)) return;

    const document = ctx.channelPost.document;
    if ((document.file_size ?? 0) > MAX_PDF_BYTES) return;

    const db = botServiceClient();
    if (db === null) return;

    try {
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${requiredEnv("TELEGRAM_BOT_TOKEN")}/${file.file_path}`;
      const response = await fetch(url);
      if (!response.ok) return;

      await intakeForwardedPdf(db, {
        bytes: new Uint8Array(await response.arrayBuffer()),
        fileName: document.file_name ?? null,
        mimeType: document.mime_type ?? null,
        from: channelSource(ctx.chat),
        source: channelSource(ctx.chat),
      });
    } catch {
      // A channel post we cannot fetch is not worth failing the webhook over;
      // Telegram would retry the whole update for hours.
    }
  });

  // Plain text is treated as a question, since most people will not use /ask.
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return ctx.reply(HELP);
    await respond(ctx, text);
  });

  return bot;
}

async function respond(
  ctx: { reply: (text: string) => Promise<unknown>; chat: { id: number } },
  question: string,
): Promise<void> {
  try {
    const { text, citations } = await answerForBot(question);
    await ctx.reply(text);
    await logBotChat("telegram", String(ctx.chat.id), question, text, citations);
  } catch (error) {
    // Never leave a question unanswered — silence reads as a broken bot.
    await ctx.reply(
      error instanceof Error && error.message.includes("Question")
        ? error.message
        : "Sorry — I could not answer that just now. Please try again.",
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    let handler = cached;
    if (handler === null) {
      // The secret token is Telegram's own webhook authentication; without it
      // anyone who learns the URL can post fabricated updates. Required, not
      // optional — omitting it when unset would turn a missing environment
      // variable into a silently open endpoint.
      const secretToken = requiredWebhookSecret("TELEGRAM_WEBHOOK_SECRET");
      handler = webhookCallback(buildBot(), "std/http", { secretToken }) as WebhookHandler;
      cached = handler;
    }
    return await handler(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // 200 on a handled failure: Telegram retries non-2xx replies for hours,
    // and a retry storm against a misconfigured bot helps nobody.
    const status = message.includes("is not set") ? 500 : 200;
    return Response.json({ error: message }, { status });
  }
}

import { answerForBot, botServiceClient, daCommand, logBotChat } from "@/lib/bots/shared";
import {
  extractMessages,
  verifySignature,
  type WhatsAppMessage,
} from "@/lib/bots/whatsapp-protocol";
import { intakeForwardedPdf, intakeReply, MAX_PDF_BYTES } from "@/lib/bots/ingest";

/**
 * WhatsApp Cloud API webhook (PLAN.md Phase 4).
 *
 * Official Cloud API only — CLAUDE.md rule 4 forbids Baileys and
 * whatsapp-web.js, which carry a real ban risk and violate WhatsApp's terms.
 * The published number is also the ingestion channel: "📤 Forward any GO to
 * this number and we'll add it to the library."
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Meta's verification handshake: echo hub.challenge when the token matches.
 * Without the token check anyone could point their own app at this URL.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge !== null) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

async function sendText(to: string, body: string): Promise<void> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return;

  await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      // WhatsApp caps a text body at 4096 characters.
      text: { body: body.slice(0, 4000) },
    }),
  }).catch(() => undefined);
}

async function downloadMedia(mediaId: string): Promise<Uint8Array | null> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) return null;

  try {
    // Two steps: look up the URL, then fetch it with the same bearer token.
    const lookup = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!lookup.ok) return null;

    const { url, file_size: fileSize } = (await lookup.json()) as {
      url?: string;
      file_size?: number;
    };
    if (url === undefined) return null;
    if ((fileSize ?? 0) > MAX_PDF_BYTES) return null;

    const media = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!media.ok) return null;

    return new Uint8Array(await media.arrayBuffer());
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  // Read the raw body first: the signature covers the exact bytes, so parsing
  // and re-serialising would change them and break verification.
  const rawBody = await request.text();

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret) {
    const signature = request.headers.get("x-hub-signature-256");
    if (!verifySignature(rawBody, signature, appSecret)) {
      return new Response("Invalid signature", { status: 401 });
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Acknowledge immediately and handle in the background: Meta retries when a
  // webhook is slow, and answering takes seconds.
  void handleMessages(extractMessages(payload));

  return new Response("OK", { status: 200 });
}

async function handleMessages(messages: WhatsAppMessage[]): Promise<void> {
  for (const message of messages) {
    try {
      if (message.type === "document" && message.document !== undefined) {
        await handleDocument(message);
      } else if (message.type === "text" && message.text !== undefined) {
        await handleText(message);
      } else {
        await sendText(
          message.from,
          "Send a question as text, or forward a GO PDF to add it to the library.",
        );
      }
    } catch {
      await sendText(message.from, "Sorry — something went wrong. Please try again.");
    }
  }
}

async function handleText(message: WhatsAppMessage): Promise<void> {
  const body = (message.text?.body ?? "").trim();
  if (body === "") return;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ap-emp-ai.in";

  if (body.toLowerCase().startsWith("/da")) {
    const args = body.split(/\s+/).slice(1);
    await sendText(message.from, daCommand(args, siteUrl));
    return;
  }

  const { text, citations } = await answerForBot(body);
  await sendText(message.from, text);
  await logBotChat("whatsapp", message.from, body, text, citations);
}

async function handleDocument(message: WhatsAppMessage): Promise<void> {
  const db = botServiceClient();
  if (db === null) {
    await sendText(message.from, "Sorry — document intake is not configured yet.");
    return;
  }

  const bytes = await downloadMedia(message.document!.id);
  if (bytes === null) {
    await sendText(message.from, "Sorry — the file could not be downloaded.");
    return;
  }

  const outcome = await intakeForwardedPdf(db, {
    bytes,
    fileName: message.document?.filename ?? null,
    mimeType: message.document?.mime_type ?? null,
    from: message.from,
    source: "whatsapp",
  });

  await sendText(message.from, intakeReply(outcome));
}

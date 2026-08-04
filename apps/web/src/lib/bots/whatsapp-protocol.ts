import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The parts of the WhatsApp Cloud API webhook contract that are pure functions.
 *
 * They live here rather than in the route because a Next.js route module may
 * only export its handlers and a fixed set of config fields — and because
 * signature verification and envelope parsing are exactly the things worth
 * testing directly, without a request.
 */

export interface WhatsAppMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  document?: { id: string; filename?: string; mime_type?: string };
}

/**
 * Verifies X-Hub-Signature-256 over the raw request body.
 *
 * Without this the endpoint accepts any POST, and a forged one could inject
 * documents into the review queue or run up model costs. Compared in constant
 * time, since a byte-by-byte comparison leaks how much of a guess was right.
 */
export function verifySignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (header === null || !header.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = header.slice("sha256=".length);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  // Lengths must match before timingSafeEqual, which throws otherwise — and a
  // malformed hex string decodes short rather than failing.
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * Pulls messages out of Meta's nested webhook envelope.
 *
 * Delivery receipts and read statuses arrive at the same URL in the same shape
 * but carry `statuses` instead of `messages`, so anything without messages
 * yields nothing rather than throwing.
 */
export function extractMessages(payload: unknown): WhatsAppMessage[] {
  const entries = (payload as { entry?: unknown[] } | null)?.entry ?? [];
  const messages: WhatsAppMessage[] = [];

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes ?? [];
    for (const change of changes) {
      const value = (change as { value?: { messages?: WhatsAppMessage[] } })?.value;
      for (const message of value?.messages ?? []) messages.push(message);
    }
  }

  return messages;
}

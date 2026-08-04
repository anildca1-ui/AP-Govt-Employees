import { createClient } from "@supabase/supabase-js";
import type { RetrievalDb } from "@ap-emp-ai/rag";
import {
  encodeEvent,
  InvalidQuestionError,
  prepareChat,
  validateQuestion,
  type ChatEvent,
} from "@/lib/chat/service";
import { CHAT_LIMIT, clientKey, rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/chat — a grounded, streaming answer.
 *
 * Body: { question: string, session?: string, lang?: "te" | "en" }
 * Response: NDJSON, one event per line — citations first, then tokens.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Retrieval runs under the anon key, not the service role. The search functions
 * only read approved documents and RLS enforces that independently, so there is
 * no reason to hand a public endpoint a key that bypasses row-level security.
 */
function retrievalClient(): RetrievalDb {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false } },
  ) as unknown as RetrievalDb;
}

/** Writes to chat_logs, which RLS exposes to the service role only. */
function loggingClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function embedQuestion(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.EMBEDDING_MODEL ?? "text-embedding-3-large",
      input: text,
      // Must match chunks.embedding's vector(1024).
      dimensions: 1024,
    }),
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as { data?: { embedding: number[] }[] };
  return payload.data?.[0]?.embedding ?? null;
}

export async function POST(request: Request): Promise<Response> {
  // Before any parsing: this endpoint spends model tokens per call, and a 429
  // with Retry-After is the correct answer to a hammer, not a queue.
  const limited = rateLimit(`chat:${clientKey(request)}`, CHAT_LIMIT);
  if (!limited.allowed) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }

  let body: { question?: unknown; session?: unknown; lang?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const session = typeof body.session === "string" ? body.session : null;
  const lang = body.lang === "te" || body.lang === "en" ? body.lang : null;

  // Validated before any client is constructed: building those reads env and
  // throws when configuration is missing, which would report a bad request as
  // a 500 blaming our setup.
  let question: string;
  try {
    question = validateQuestion(body.question);
  } catch (error) {
    const message = error instanceof InvalidQuestionError ? error.message : "Invalid question";
    return Response.json({ error: message }, { status: 400 });
  }

  let prepared;
  try {
    prepared = await prepareChat(
      {
        db: retrievalClient(),
        embed: embedQuestion,
        apiKey: requiredEnv("GEMINI_API_KEY"),
        ...(process.env.LLM_MODEL !== undefined && { model: process.env.LLM_MODEL }),
      },
      { question, signal: request.signal },
    );
  } catch (error) {
    if (error instanceof InvalidQuestionError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    // Configuration and retrieval failures are ours, and must not be reported
    // as an answer — an empty answer would read as "no such rule exists".
    const message = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }

  const { retrieval, citations, stream } = prepared;
  const encoder = new TextEncoder();
  let answer = "";

  const ndjson = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(encodeEvent(event)));

      // Citations first: the reader sees which GOs are being used while the
      // answer is still being written.
      send({ type: "citations", citations, mode: retrieval.mode });

      try {
        for await (const token of stream) {
          answer += token;
          send({ type: "token", text: token });
        }
        // Logged after the last token, before the stream closes: the reader
        // already has the whole answer, and the id is what the 👍/👎 buttons
        // need to attach feedback to this specific reply.
        const logId = await logChat({ session, lang, question, answer, citations });
        send({ type: "done", logId });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Answer generation failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(ndjson, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Proxies that buffer would defeat the point of streaming.
      "x-accel-buffering": "no",
    },
  });
}

/** Returns the chat_logs row id, or null when logging is off or failed. */
async function logChat({
  session,
  lang,
  question,
  answer,
  citations,
}: {
  session: string | null;
  lang: "te" | "en" | null;
  question: string;
  answer: string;
  citations: { documentId: string }[];
}): Promise<string | null> {
  const db = loggingClient();
  if (db === null) return null;
  try {
    const { data, error } = await db
      .from("chat_logs")
      .insert({
        session,
        question,
        answer,
        cited_docs: citations.map((c) => c.documentId),
        lang,
        channel: "web",
      })
      .select("id")
      .single();
    if (error) return null;
    return (data as { id: string }).id;
  } catch {
    // Logging exists to improve answers later; losing a row must never surface
    // as a failed answer to the person who asked.
    return null;
  }
}

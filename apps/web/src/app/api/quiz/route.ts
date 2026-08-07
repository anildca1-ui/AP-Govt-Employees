import { createClient } from "@supabase/supabase-js";
import { buildContext, retrieve, type RetrievalDb } from "@ap-emp-ai/rag";
import { findTest, parseQuiz, QUIZ_SYSTEM_PROMPT } from "@/lib/library/tests-hub";
import { clientKey, QUIZ_LIMIT, rateLimit } from "@/lib/rate-limit";

/**
 * POST /api/quiz — practice questions generated from the corpus.
 *
 * Body: { testId: string }
 *
 * Retrieval first, generation second, exactly as the chat does. A quiz written
 * from model memory would teach an employee a rule that does not exist, which
 * is worse than no quiz at all — so when retrieval comes back empty this
 * returns no questions rather than letting the model improvise.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(`quiz:${clientKey(request)}`, QUIZ_LIMIT);
  if (!limited.allowed) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }

  let body: { testId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const testId = typeof body.testId === "string" ? body.testId : "";
  const test = findTest(testId);
  if (test === undefined) return Response.json({ error: "Unknown test" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!url || !anonKey || !apiKey) {
    return Response.json({ error: "Quiz generation is not configured" }, { status: 503 });
  }

  const db = createClient(url, anonKey, {
    auth: { persistSession: false },
  }) as unknown as RetrievalDb;

  // Search on the paper's own topics: that is what the syllabus says the exam
  // covers, so it is the right query for finding the rules it will test.
  const query = test.papers.flatMap((paper) => paper.topics).join("; ");

  let context: string;
  try {
    const retrieval = await retrieve(db, { query, matchCount: 12 });
    if (retrieval.chunks.length === 0) {
      return Response.json({ questions: [], reason: "no-corpus" });
    }
    context = buildContext(retrieval, `Write up to 20 practice questions for ${test.title}.`);
  } catch (error) {
    // Cause to the log, a fixed string over the wire — the client renders its
    // own localised text off the status.
    console.error("[quiz] retrieval failed:", error);
    return Response.json({ error: "Retrieval failed" }, { status: 500 });
  }

  try {
    const response = await fetch(
      `${GEMINI}/${encodeURIComponent(process.env.LLM_MODEL ?? "gemini-2.5-flash")}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: QUIZ_SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: context }] }],
          generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
        }),
      },
    );

    if (!response.ok) {
      return Response.json({ error: `Generation failed (${response.status})` }, { status: 502 });
    }

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (payload.candidates ?? [])
      .flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");

    // Questions missing a source or with a malformed option set are dropped,
    // not repaired: fewer questions beats a question nobody can check.
    return Response.json({ questions: parseQuiz(text) });
  } catch (error) {
    console.error("[quiz] generation failed:", error);
    return Response.json({ error: "Generation failed" }, { status: 500 });
  }
}

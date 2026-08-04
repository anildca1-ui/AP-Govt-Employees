import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/chat/feedback — record a 👍 or 👎 against one answer.
 *
 * Body: { logId: string, feedback: 1 | -1 }
 *
 * This is how the thumbs-down answers get found for review, which is the only
 * reason chat_logs collects them at all (PLAN.md Phase 2).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Matches chat_logs.feedback's check constraint in migration 001. */
const ALLOWED = new Set([1, -1]);

export async function POST(request: Request): Promise<Response> {
  let body: { logId?: unknown; feedback?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const logId = typeof body.logId === "string" ? body.logId.trim() : "";
  const feedback = typeof body.feedback === "number" ? body.feedback : Number.NaN;

  if (logId === "") return Response.json({ error: "logId is required" }, { status: 400 });
  if (!ALLOWED.has(feedback)) {
    return Response.json({ error: "feedback must be 1 or -1" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // chat_logs is service-role only under RLS.
  if (!url || !key) return Response.json({ error: "Logging is not configured" }, { status: 503 });

  const db = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await db.from("chat_logs").update({ feedback }).eq("id", logId);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

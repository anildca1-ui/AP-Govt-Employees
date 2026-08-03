import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for the admin review queue. ingest_queue and the
 * write side of documents have no anon/authenticated RLS policies on purpose
 * (migration 001), so the admin surface must use the service role — which is
 * exactly why this module has to stay server-only.
 */

// The service-role key bypasses RLS entirely; if a bundler slip ever pulls this
// into client code the build must die at load time, not ship the key.
if (typeof window !== "undefined") {
  throw new Error("lib/admin/db is server-only and must never run in the browser");
}

export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || url === "") {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set — copy .env.example to .env and fill in the Supabase URL (`pnpm db:start` prints it for local dev)",
    );
  }
  if (key === undefined || key === "") {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — the admin queue needs the service-role key; keep it server-side only, never NEXT_PUBLIC_",
    );
  }
  // No browser, no user session: nothing to persist or refresh.
  return createClient(url, key, { auth: { persistSession: false } });
}

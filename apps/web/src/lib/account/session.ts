import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client bound to the request's cookies.
 *
 * Phone-OTP auth (PLAN.md Phase 6). Everything a signed-in person can reach
 * goes through this client, under their own JWT — so the RLS policies added in
 * migration 006 are what actually enforce "your row and no one else's", rather
 * than a check in application code that a future refactor could drop.
 */

export function serverAuthClient(cookieStore: Awaited<ReturnType<typeof cookies>>): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; the middleware refreshes the
          // session instead. Swallowing here is the documented pattern.
        }
      },
    },
  }) as unknown as SupabaseClient;
}

export interface SignedInUser {
  id: string;
  phone: string | null;
}

/** The signed-in user, or null. Never throws — a signed-out visitor is normal. */
export async function currentUser(): Promise<SignedInUser | null> {
  const cookieStore = await cookies();
  const db = serverAuthClient(cookieStore);
  if (db === null) return null;

  try {
    const { data, error } = await db.auth.getUser();
    if (error || data.user === null) return null;
    return { id: data.user.id, phone: data.user.phone ?? null };
  } catch {
    return null;
  }
}

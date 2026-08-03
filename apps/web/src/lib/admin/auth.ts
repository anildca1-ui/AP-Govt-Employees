import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Interim admin gate until Phase 6 lands real auth (phone-OTP via Supabase):
 * one shared secret in ADMIN_TOKEN, presented through the login form and then
 * carried in an httpOnly cookie. There are no per-admin sessions to revoke —
 * rotating the env var logs everyone out, which is the whole lifecycle model.
 * Every admin page and every server action must start with requireAdmin().
 *
 * The login server action itself lives in the admin route's actions.ts ("use
 * server" files may only export async actions); it delegates the comparison
 * and cookie write to establishAdminSession() here so there is exactly one
 * implementation of the check.
 */

// This module gates the service-role path, so a bundler slip that pulls it into
// client code must fail loudly at load time, not leak quietly.
if (typeof window !== "undefined") {
  throw new Error("lib/admin/auth is server-only and must never run in the browser");
}

export const ADMIN_COOKIE = "admin_token";

/**
 * Constant-time comparison of a presented token against ADMIN_TOKEN.
 * An unset or empty env always denies: "nobody configured a token" must mean
 * "admin is closed", never "admin is open with an empty password".
 */
export function tokenMatches(
  candidate: string | undefined,
  expected: string | undefined,
): boolean {
  if (expected === undefined || expected === "") return false;
  if (candidate === undefined || candidate === "") return false;
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on unequal lengths; the length itself is not a
  // secret worth hiding, so guard rather than catch.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return tokenMatches(store.get(ADMIN_COOKIE)?.value, process.env.ADMIN_TOKEN);
}

/** Hard gate for server actions: throws instead of rendering a login form. */
export async function requireAdmin(): Promise<void> {
  if (await isAdmin()) return;
  throw new Error(
    process.env.ADMIN_TOKEN
      ? "admin authentication required"
      : "ADMIN_TOKEN is not set — admin access is disabled until it is configured in .env",
  );
}

/**
 * Runs the same comparison as requireAdmin and, on success, stores the token in
 * the cookie the later checks read. Returns false rather than throwing so the
 * login form can re-render with a message instead of a 500.
 */
export async function establishAdminSession(token: string): Promise<boolean> {
  if (!tokenMatches(token, process.env.ADMIN_TOKEN)) return false;
  const store = await cookies();
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Long enough for a review session, short enough that a stolen laptop
    // does not stay an admin forever.
    maxAge: 60 * 60 * 12,
  });
  return true;
}

"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { serverAuthClient } from "@/lib/account/session";
import {
  CONSENT_POLICY_VERSION,
  profileToRow,
  validateProfile,
  type ConsentPurpose,
} from "@/lib/account/profile";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";

/** Server actions for account, profile, consent and deletion (Phase 6). */

function localeOf(form: FormData): Locale {
  const value = form.get("locale");
  return typeof value === "string" && isLocale(value) ? value : defaultLocale;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function sendOtp(formData: FormData): Promise<void> {
  const locale = localeOf(formData);
  const phone = field(formData, "phone");
  const store = await cookies();
  const db = serverAuthClient(store);
  if (db === null) redirect(`/${locale}/account?error=unconfigured`);

  // Supabase sends the OTP; we never see or store it.
  const { error } = await db.auth.signInWithOtp({ phone });
  redirect(
    error
      ? `/${locale}/account?error=otp&phone=${encodeURIComponent(phone)}`
      : `/${locale}/account?sent=1&phone=${encodeURIComponent(phone)}`,
  );
}

export async function verifyOtp(formData: FormData): Promise<void> {
  const locale = localeOf(formData);
  const phone = field(formData, "phone");
  const token = field(formData, "otp");
  const store = await cookies();
  const db = serverAuthClient(store);
  if (db === null) redirect(`/${locale}/account?error=unconfigured`);

  const { error } = await db.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) {
    redirect(`/${locale}/account?error=verify&phone=${encodeURIComponent(phone)}`);
  }

  revalidatePath(`/${locale}/account`);
  redirect(`/${locale}/account`);
}

export async function signOut(formData: FormData): Promise<void> {
  const locale = localeOf(formData);
  const store = await cookies();
  const db = serverAuthClient(store);
  if (db !== null) await db.auth.signOut();
  redirect(`/${locale}/account`);
}

export async function saveProfile(formData: FormData): Promise<void> {
  const locale = localeOf(formData);
  const store = await cookies();
  const db = serverAuthClient(store);
  if (db === null) redirect(`/${locale}/account?error=unconfigured`);

  const { data: auth } = await db.auth.getUser();
  const user = auth.user;
  if (user === null) redirect(`/${locale}/account`);

  const { profile, problems } = validateProfile({
    name: field(formData, "name"),
    basicPay: field(formData, "basicPay"),
    scale: field(formData, "scale"),
    dept: field(formData, "dept"),
    joinDate: field(formData, "joinDate"),
    scheme: field(formData, "scheme"),
  });

  // The code, not the message: the page translates it. Sending the message put
  // "Basic pay must be a positive number" on a Telugu page.
  if (problems.length > 0) {
    redirect(`/${locale}/account?error=${problems[0]!.code}`);
  }

  // Under the user's own JWT: RLS decides whose row this is, not this code.
  const { error } = await db.from("users").upsert(profileToRow(user.id, profile));
  if (error) {
    // Postgres speaking to a developer — "new row violates row-level security
    // policy for table users". Logged, not shown.
    console.error("[account] profile save failed:", error.message);
    redirect(`/${locale}/account?error=saveFailed`);
  }

  // Consent is recorded as an event each time it is given, never overwritten —
  // the question is what someone agreed to on a given day.
  const purposes: ConsentPurpose[] = ["profile_storage", "chat_logging"];
  const events = purposes
    .filter((purpose) => formData.get(purpose) !== null)
    .map((purpose) => ({
      user_id: user.id,
      purpose,
      granted: true,
      policy_text: field(formData, `${purpose}_text`) || null,
      policy_version: CONSENT_POLICY_VERSION,
    }));

  if (events.length > 0) await db.from("consent_events").insert(events);

  revalidatePath(`/${locale}/account`);
  revalidatePath(`/${locale}/dashboard`);
  redirect(`/${locale}/account?saved=1`);
}

/**
 * Delete-my-data (CLAUDE.md rule 7).
 *
 * Deletes the auth user with the service role, which cascades to the profile
 * and the consent log and nulls the link on chat_logs. Deleting only the
 * profile row would leave the account — and therefore the person's phone
 * number — in auth.users, which is not deletion.
 */
export async function deleteMyData(formData: FormData): Promise<void> {
  const locale = localeOf(formData);
  if (field(formData, "confirm") !== "DELETE") {
    redirect(`/${locale}/account?error=confirm`);
  }

  const store = await cookies();
  const db = serverAuthClient(store);
  if (db === null) redirect(`/${locale}/account?error=unconfigured`);

  const { data: auth } = await db.auth.getUser();
  const user = auth.user;
  if (user === null) redirect(`/${locale}/account`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) redirect(`/${locale}/account?error=unconfigured`);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) redirect(`/${locale}/account?error=delete`);

  await db.auth.signOut();
  redirect(`/${locale}/account?deleted=1`);
}

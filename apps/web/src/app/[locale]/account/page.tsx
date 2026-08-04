import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { deleteMyData, saveProfile, sendOtp, signOut, verifyOtp } from "./actions";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary, type Dictionary } from "@/i18n/dictionary";
import { currentUser, serverAuthClient } from "@/lib/account/session";
import { PENSION_SCHEMES, rowToProfile } from "@/lib/account/profile";

/** Account: phone-OTP sign-in, profile, consent, and delete-my-data (Phase 6). */
export const dynamic = "force-dynamic";

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sent?: string; phone?: string; error?: string; saved?: string; deleted?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const state = await searchParams;

  const user = await currentUser();

  if (user === null) {
    return (
      <SignIn
        locale={locale}
        dict={dict}
        sent={state.sent === "1"}
        phone={state.phone ?? ""}
        error={state.error}
        deleted={state.deleted === "1"}
      />
    );
  }

  const store = await cookies();
  const db = serverAuthClient(store);
  const { data } = db === null
    ? { data: null }
    : await db.from("users").select("*").eq("id", user.id).maybeSingle();
  const profile = rowToProfile(data as Record<string, unknown> | null);

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dict.account.title}</h1>
          {user.phone !== null && <p className="text-sm text-slate-600">{user.phone}</p>}
        </div>
        <form action={signOut}>
          <input type="hidden" name="locale" value={locale} />
          <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
            {dict.account.signOut}
          </button>
        </form>
      </header>

      {state.saved === "1" && <p className="text-sm text-green-700">{dict.account.saved}</p>}
      {state.error !== undefined && <p className="text-sm text-red-700">{state.error}</p>}

      <form action={saveProfile} className="space-y-3 rounded-lg border border-slate-200 p-4">
        <h2 className="font-medium">{dict.account.profile}</h2>
        <input type="hidden" name="locale" value={locale} />

        <Field label={dict.account.name} name="name" value={profile.name} type="text" />
        <Field label={dict.account.basicPay} name="basicPay" value={profile.basicPay === null ? null : String(profile.basicPay)} />
        <Field label={dict.account.scale} name="scale" value={profile.scale} type="text" />
        <Field label={dict.account.dept} name="dept" value={profile.dept} type="text" />
        <Field label={dict.account.joinDate} name="joinDate" value={profile.joinDate} type="date" />

        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">{dict.account.scheme}</span>
          <select
            name="scheme"
            defaultValue={profile.scheme ?? ""}
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">—</option>
            {PENSION_SCHEMES.map((scheme) => (
              <option key={scheme} value={scheme}>
                {scheme}
              </option>
            ))}
          </select>
        </label>

        {/* Consent is taken here, with the exact wording stored alongside the
            event — "we asked" has to be provable, and provable includes what
            was asked (CLAUDE.md rule 7). */}
        <fieldset className="space-y-2 rounded border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium">{dict.account.consentTitle}</legend>
          <label className="flex gap-2 text-sm">
            <input type="checkbox" name="profile_storage" defaultChecked className="mt-1" />
            <span>{dict.account.consentProfile}</span>
          </label>
          <input type="hidden" name="profile_storage_text" value={dict.account.consentProfile} />
          <label className="flex gap-2 text-sm">
            <input type="checkbox" name="chat_logging" className="mt-1" />
            <span>{dict.account.consentChat}</span>
          </label>
          <input type="hidden" name="chat_logging_text" value={dict.account.consentChat} />
        </fieldset>

        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          {dict.account.save}
        </button>
      </form>

      <form action={deleteMyData} className="space-y-3 rounded-lg border border-red-200 p-4">
        <h2 className="font-medium text-red-800">{dict.account.deleteTitle}</h2>
        <p className="text-sm text-slate-700">{dict.account.deleteBody}</p>
        <input type="hidden" name="locale" value={locale} />
        <label className="block text-sm">
          <span className="mb-1 block text-slate-700">{dict.account.deleteConfirm}</span>
          <input
            type="text"
            name="confirm"
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <button type="submit" className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white">
          {dict.account.delete}
        </button>
      </form>
    </div>
  );
}

function SignIn({
  locale,
  dict,
  sent,
  phone,
  error,
  deleted,
}: {
  locale: Locale;
  dict: Dictionary;
  sent: boolean;
  phone: string;
  error: string | undefined;
  deleted: boolean;
}) {
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">{dict.account.signIn}</h1>
      {deleted && <p className="text-sm text-green-700">{dict.account.deleted}</p>}
      {error === "unconfigured" && <p className="text-sm text-slate-600">{dict.account.notConfigured}</p>}
      {error === "otp" && <p className="text-sm text-red-700">{dict.account.otpFailed}</p>}
      {error === "verify" && <p className="text-sm text-red-700">{dict.account.verifyFailed}</p>}

      {sent ? (
        <form action={verifyOtp} className="space-y-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="phone" value={phone} />
          <p className="text-sm text-green-700">{dict.account.otpSent}</p>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">{dict.account.otp}</span>
            <input
              type="text"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            {dict.account.verify}
          </button>
        </form>
      ) : (
        <form action={sendOtp} className="space-y-3">
          <input type="hidden" name="locale" value={locale} />
          <label className="block text-sm">
            <span className="mb-1 block text-slate-700">{dict.account.phone}</span>
            <input
              type="tel"
              name="phone"
              placeholder="+91…"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            {dict.account.sendOtp}
          </button>
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  name,
  value,
  type = "number",
}: {
  label: string;
  name: string;
  value: string | null;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-slate-700">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={value ?? ""}
        className="w-full rounded-md border border-slate-300 px-3 py-2"
      />
    </label>
  );
}

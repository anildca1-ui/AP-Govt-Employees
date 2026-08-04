import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { formatINR, rateOn, type RateRow } from "@ap-emp-ai/calc";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";
import { currentUser, serverAuthClient } from "@/lib/account/session";
import { rowToProfile } from "@/lib/account/profile";
import { ratesFor } from "@/lib/calculators/rates-data";
import { CALCULATORS, labelsFor } from "@/lib/calculators/registry";

/**
 * Personal dashboard (PLAN.md Phase 6).
 *
 * The two things a saved profile is actually worth: calculators that arrive
 * prefilled, and a straight answer to "what does the current DA mean for MY
 * pay" — the question the reference sites never answer for an individual.
 */
export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  const user = await currentUser();
  if (user === null) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.account.dashboard}</h1>
        <Link href={`/${locale}/account`} className="text-sm underline">
          {dict.account.signIn}
        </Link>
      </div>
    );
  }

  const store = await cookies();
  const db = serverAuthClient(store);
  const { data } = db === null
    ? { data: null }
    : await db.from("users").select("*").eq("id", user.id).maybeSingle();
  const profile = rowToProfile(data as Record<string, unknown> | null);

  let daLine: { percent: number; monthly: number; source: string | null; unverified: boolean } | null = null;
  if (profile.basicPay !== null) {
    const da = rateOn(
      ratesFor<{ percent: number }>("DA") as RateRow<{ percent: number }>[],
      "DA",
      new Date().toISOString().slice(0, 10),
    );
    daLine = {
      percent: da.payload.percent,
      monthly: Math.round((profile.basicPay * da.payload.percent) / 100),
      source: da.source?.go_number ?? null,
      unverified: da.unverified,
    };
  }

  const prefill = profile.basicPay === null ? "" : `?basicPay=${profile.basicPay}`;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.account.dashboard}</h1>
        <p className="text-sm text-slate-600">{dict.account.prefilled}</p>
      </header>

      <section className="rounded-lg border border-slate-200 p-4">
        <h2 className="font-medium">{dict.account.daImpact}</h2>
        {daLine === null ? (
          <p className="mt-1 text-sm text-slate-600">
            <Link href={`/${locale}/account`} className="underline">
              {dict.account.noProfile}
            </Link>
          </p>
        ) : (
          <div className="mt-2 space-y-1 text-sm">
            <p>
              {dict.account.daImpactBody}:{" "}
              <span className="font-medium tabular-nums">{formatINR(daLine.monthly)}</span>{" "}
              <span className="text-slate-500">({daLine.percent}%)</span>
            </p>
            {daLine.source !== null && (
              <p className="text-xs text-slate-500">
                {dict.calculators.asPer}: {daLine.source}
              </p>
            )}
            {daLine.unverified && (
              <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                {dict.calculators.unverifiedWarning}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-slate-500 uppercase">
          {dict.calculators.title}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {CALCULATORS.filter((meta) => meta.featured).map((meta) => {
            const { title, description } = labelsFor(meta, dict);
            return (
              <li key={meta.id}>
                <Link
                  href={`/${locale}/calculators/${meta.slug}${prefill}`}
                  className="block h-full rounded-lg border border-slate-200 p-4 transition hover:border-slate-300"
                >
                  <h3 className="font-medium">{title}</h3>
                  <p className="mt-1 text-sm text-slate-600">{description}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

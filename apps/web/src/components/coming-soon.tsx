import type { Dictionary } from "@/i18n/dictionary";

/**
 * Placeholder for a section that has a nav entry but no implementation yet, so
 * the shell is fully navigable instead of leading to 404s. Each phase replaces
 * one of these with the real page.
 */
export function ComingSoon({ title, dict }: { title: string; dict: Dictionary }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="inline-block rounded bg-slate-100 px-2 py-0.5 text-sm text-slate-600">
        {dict.common.comingSoon}
      </p>
    </div>
  );
}

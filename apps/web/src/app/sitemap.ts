import type { MetadataRoute } from "next";
import { locales } from "@/i18n/config";
import { CALCULATORS } from "@/lib/calculators/registry";
import { DEPARTMENTAL_TESTS } from "@/lib/library/tests-hub";
import { fetchRecent, publicClient } from "@/lib/library/queries";

/**
 * Sitemap (PLAN.md Phase 6).
 *
 * Every static route in both locales, plus the most recently approved GOs. The
 * per-GO pages are the ones search actually needs: someone googling a GO number
 * should land on our page for that order, which cites and links the original.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const staticPaths = [
    "",
    "/gos",
    "/chat",
    "/calculators",
    ...CALCULATORS.map((calculator) => `/calculators/${calculator.slug}`),
    "/news",
    "/tests",
    ...DEPARTMENTAL_TESTS.map((test) => `/tests/${test.id}`),
    "/links",
    "/privacy",
    "/disclaimer",
  ];

  const entries: MetadataRoute.Sitemap = locales.flatMap((locale) =>
    staticPaths.map((path) => ({
      url: `${base}/${locale}${path}`,
      changeFrequency: path === "" || path === "/news" ? ("daily" as const) : ("weekly" as const),
      priority: path === "" ? 1 : 0.7,
    })),
  );

  // Approved GOs, best-effort: a site with no database still has a sitemap.
  const db = publicClient();
  if (db !== null) {
    try {
      const recent = await fetchRecent(db, 500);
      for (const document of recent) {
        // Superseded orders are noindex on the page itself; listing them here
        // would invite search engines to a page that asks not to be indexed.
        if (document.superseded_by !== null) continue;
        for (const locale of locales) {
          entries.push({
            url: `${base}/${locale}/gos/${document.id}`,
            changeFrequency: "monthly",
            priority: 0.8,
          });
        }
      }
    } catch {
      // The static half of the sitemap is still worth serving.
    }
  }

  return entries;
}

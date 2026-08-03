import type { MetadataRoute } from "next";
import { defaultLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionary";

/**
 * Installed to the home screen, the app opens in Telugu — the default locale —
 * and the middleware then honours a reader's saved choice on later visits.
 */
export default function manifest(): MetadataRoute.Manifest {
  const dict = getDictionary(defaultLocale);

  return {
    name: dict.site.name,
    short_name: dict.site.shortName,
    description: dict.site.description,
    lang: defaultLocale,
    dir: "ltr",
    start_url: `/${defaultLocale}`,
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

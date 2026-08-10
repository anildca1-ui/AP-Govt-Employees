import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The review queue and API endpoints are not content.
        disallow: ["/te/admin", "/en/admin", "/api/"],
      },
    ],
    // Only when the public address is known. The old localhost fallback sent
    // crawlers to a sitemap that does not exist anywhere they can reach.
    ...(base === null ? {} : { sitemap: `${base}/sitemap.xml` }),
  };
}

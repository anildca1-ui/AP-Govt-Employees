/**
 * The one answer to "what is this site's public address?".
 *
 * Four places needed it and each invented its own fallback, which produced two
 * real defects on a zero-config deploy:
 *
 * - robots.txt and sitemap.xml defaulted to http://localhost:3000, so the
 *   first deploy handed Google 52 localhost URLs. The pages render fine, so
 *   nothing looks broken — the site just never gets indexed.
 * - The bots defaulted to https://ap-emp-ai.in, a domain nobody on this
 *   project is known to hold. If anyone ever registers it, every Telegram and
 *   WhatsApp reply is directing employees to a stranger's server.
 *
 * The rule: a configured address is used; a Vercel production deploy can be
 * inferred; otherwise the answer is null and the caller must degrade — omit
 * the sitemap line, skip the link in the bot reply — rather than publish an
 * address that is wrong. A missing link is a nuisance; a wrong one is a trap.
 */
export function siteUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured !== undefined && configured !== "") {
    return configured.replace(/\/+$/, "");
  }

  // Set by Vercel at build time to the project's stable production hostname
  // (bare host, no scheme), so the default deploy indexes correctly with no
  // configuration at all.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel !== undefined && vercel !== "") {
    return `https://${vercel}`;
  }

  return null;
}

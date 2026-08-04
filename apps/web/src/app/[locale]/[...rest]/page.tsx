import { notFound } from "next/navigation";

/**
 * Catch-all that exists only to turn an unmatched URL into a 404 rendered
 * *inside* the locale layout.
 *
 * Without it, Next serves its own built-in 404 for any URL that matches no
 * route. That page renders outside every layout: no footer, so no "not an
 * official Government of AP website" line (PLAN.md Part 5, checkpoint 4), and
 * its text is English-only on a Telugu-first site. Adding [locale]/not-found.tsx
 * alone does not help — a segment's not-found boundary is only reached when
 * something inside that segment calls notFound(), which is exactly what this
 * page does.
 *
 * Explicit routes take priority over a catch-all, so this shadows nothing.
 */
export default function CatchAllNotFound(): never {
  notFound();
}

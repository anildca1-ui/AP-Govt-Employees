/**
 * GO-number detection — the exact-match short-circuit in the hybrid search
 * described in PLAN.md Part 2.
 *
 * When a user types "G.O.Ms.No.51 lo enti undi?" they want that specific GO, not
 * the twelve documents nearest it in embedding space. Retrieval checks this
 * first; only when it finds nothing does it fall back to
 * 0.6*vector + 0.4*tsvector.
 *
 * Real corpus spelling is inconsistent — "G.O.Ms.No.51", "GO Ms No 51",
 * "G.O.MS.No. 51", "G.O.Rt.No.1234" all occur — so the separators are optional
 * and matching is case-insensitive.
 */

export type GoType = "Ms" | "Rt";

export interface GoReference {
  /** Normalised type, regardless of how it was spelled in the query. */
  type: GoType;
  /** The serial number as an integer: "G.O.Ms.No.051" → 51. */
  number: number;
  /** Canonical form for display and for an equality lookup on documents.go_number. */
  canonical: string;
  /** The substring that matched, useful for highlighting the user's query. */
  raw: string;
}

const GO_PATTERN = /\bG\.?\s*O\.?\s*(Ms|Rt)\.?\s*No\.?\s*(\d{1,6})\b/i;

/**
 * Returns the first GO reference in the text, or null when the query is a plain
 * natural-language question and retrieval should go down the hybrid path.
 */
export function findGoReference(text: string): GoReference | null {
  const match = GO_PATTERN.exec(text);
  if (match === null) return null;

  const [raw, rawType, rawNumber] = match;
  if (rawType === undefined || rawNumber === undefined) return null;

  const type: GoType = rawType.toLowerCase() === "ms" ? "Ms" : "Rt";
  const number = Number.parseInt(rawNumber, 10);

  return {
    type,
    number,
    canonical: `G.O.${type}.No.${number}`,
    raw,
  };
}

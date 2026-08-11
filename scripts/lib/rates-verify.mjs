/**
 * The bookkeeping behind `pnpm rates:verify`, kept pure so it can be tested.
 *
 * Marking a rate verified is the most consequential edit in this project: it
 * removes the on-screen warning, so from that moment the figure presents itself
 * to a government employee as checked against the Government Order. Nothing
 * here decides that — a person does. This only records the decision, and
 * records it in a way that says who checked what, and when.
 */

/** Every rate row that nobody has confirmed against a GO yet. */
export function unverifiedRows(rates) {
  const out = [];
  for (const [kind, rows] of Object.entries(rates)) {
    if (!Array.isArray(rows)) continue;
    rows.forEach((row, index) => {
      if (row?.source_go?.verified !== true) out.push({ kind, index, row });
    });
  }
  return out;
}

/** A one-line description of what the row claims, for the question. */
export function describe(kind, row) {
  const period = `${row.effective_from} → ${row.effective_to ?? "open"}`;
  const payload = row.payload ?? {};

  if (typeof payload.percent === "number") return `${period}   ${payload.percent}%`;
  if (Array.isArray(payload.slabs)) {
    return `${period}   ${payload.slabs.map((s) => `${s.percent}%`).join(" / ")}`;
  }
  if (typeof payload.minimum === "number") {
    return `${period}   scale ${payload.minimum}–${payload.maximum}`;
  }
  if (typeof payload.employee_percent === "number") {
    return `${period}   employee ${payload.employee_percent}% + government ${payload.government_percent}%`;
  }
  return `${period}   ${kind}`;
}

/**
 * Finds the PDF for a GO number among the known sources.
 *
 * Matched on the digits, because the same order is written G.O.Ms.No.60,
 * GO Ms No 60 and G.O.MS.No.60 across the sites it came from.
 */
export function pdfFor(goNumber, sources) {
  if (typeof goNumber !== "string") return null;
  const digits = /(\d+)\s*$/.exec(goNumber.trim());
  if (digits === null) return null;

  const wanted = digits[1];
  for (const doc of sources?.documents ?? []) {
    const found = /G\.?O\.?\s*\.?(?:Ms|MS|Rt)?\.?\s*\.?No\.?\s*(\d+)/i.exec(doc.claim ?? "");
    if (found !== null && found[1] === wanted) return doc.url;
  }
  return null;
}

/**
 * Records that a person checked this row against the GO.
 *
 * `checkedOn` is passed in rather than read from the clock so the result is
 * reproducible in a test. Returns a new object; the caller writes the file.
 */
export function markVerified(rates, kind, index, { checkedOn, goNumber, goDate, note }) {
  const copy = structuredClone(rates);
  const row = copy[kind][index];

  row.source_go = {
    ...row.source_go,
    ...(goNumber === undefined ? {} : { go_number: goNumber }),
    ...(goDate === undefined ? {} : { go_date: goDate }),
    verified: true,
    verified_on: checkedOn,
    // The old note usually says "from research, unconfirmed", which is exactly
    // what is no longer true. Keep whatever the checker said instead.
    note: note ?? null,
  };
  return copy;
}

/**
 * Records a correction: the GO says something different from what we hold.
 *
 * The value changes AND the row stays unverified, because a figure typed from
 * a reading is still one person's transcription — it earns the warning until
 * someone confirms it against the order itself.
 */
export function markCorrected(rates, kind, index, { checkedOn, correction, note }) {
  const copy = structuredClone(rates);
  const row = copy[kind][index];

  row.payload = { ...row.payload, ...correction };
  row.source_go = {
    ...row.source_go,
    verified: false,
    corrected_on: checkedOn,
    note: note ?? `Corrected from the GO on ${checkedOn}; confirm the new value.`,
  };
  return copy;
}

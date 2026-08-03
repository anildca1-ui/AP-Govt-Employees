import type { ChunkInput, TextChunk } from "../pipeline/types.js";

/**
 * Stage 3 of the pipeline (PLAN.md Part 2): extracted text → retrieval-sized
 * chunks.
 *
 * GOs are numbered-paragraph documents, so splitting follows their own
 * structure — blank lines, page breaks, and "2. ", "3. " paragraph starts —
 * rather than a fixed character window. A retrieval hit is read alone, far
 * from its siblings, which drives two choices here:
 *
 *  - every chunk is prefixed with a provenance header built from the document
 *    metadata, so the answer LLM can cite GO number + date (quality rule 1)
 *    even when only one chunk of the document is retrieved;
 *  - oversize paragraphs are split at sentence boundaries with a tail overlap,
 *    so a fact straddling the cut appears whole in at least one chunk.
 *
 * Pure function, no I/O — embedding and persistence are later stages.
 */

export const DEFAULT_MAX_CHARS = 1800;
export const DEFAULT_OVERLAP_CHARS = 200;

/**
 * Header fields are capped so a run-on subject line cannot crowd the actual
 * content out of the chunk's character budget.
 */
export const MAX_HEADER_FIELD_CHARS = 120;

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

/** A slice of the document plus where it begins in the original text. */
interface Span {
  /** Absolute offset of the first character in ChunkInput.text. */
  start: number;
  text: string;
}

/** Blank line(s) or a page break — extract.ts joins pages with \f. */
const PARA_BREAK = /\f|(?:\r?\n[ \t]*){2,}/g;

/**
 * A numbered-paragraph start on a fresh line ("2. ", "12. "). Two digits at
 * most: GOs rarely exceed 99 paragraphs, and longer runs of digits at a line
 * start are years or amounts, not paragraph numbers.
 */
const NUMBERED_PARA_START = /\n[ \t]*\d{1,2}\.\s/g;

/**
 * Section headings that must never dangle at the end of a chunk: the text they
 * introduce is meaningless without them ("ORDER:" is what makes the following
 * paragraph the operative part of a GO). Covers the spaced-out "O R D E R"
 * typesetting common in government PDFs, and numbered annexures/schedules.
 */
const SECTION_HEADING = /^(?:O\s?R\s?D\s?E\s?R|ANNEXURE|APPENDIX|SCHEDULE)(?:[\s-]+(?:[IVXLC]+|\d+[A-Z]?))?\s*:?\s*$/i;

/** Sentence end followed by whitespace; includes the danda for Telugu text. */
const SENTENCE_BOUNDARY = /[.!?।]["')\]]*\s+/g;

export function chunkDocument(input: ChunkInput, opts: ChunkOptions = {}): TextChunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = opts.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    throw new RangeError(`maxChars must be a positive number, received ${maxChars}`);
  }
  if (!Number.isFinite(overlapChars) || overlapChars < 0 || overlapChars >= maxChars) {
    throw new RangeError(
      `overlapChars must be in [0, maxChars), received ${overlapChars} with maxChars ${maxChars}`,
    );
  }

  const header = buildHeaderLine(input.header);
  const pageStarts = computePageStarts(input.text);
  const paras = attachHeadings(splitParagraphs(input.text));

  const bodies: Span[] = [];
  let current: Span[] = [];
  let currentLen = 0;
  const flush = () => {
    const first = current[0];
    if (first !== undefined) {
      bodies.push({ start: first.start, text: current.map((p) => p.text).join("\n\n") });
    }
    current = [];
    currentLen = 0;
  };

  for (const para of paras) {
    if (para.text.length > maxChars) {
      // An oversize paragraph cannot share a chunk; it becomes its own run of
      // overlapping pieces.
      flush();
      bodies.push(...splitOversize(para, maxChars, overlapChars));
      continue;
    }
    // "\n\n".length accounts for the join separator when merging.
    if (currentLen > 0 && currentLen + 2 + para.text.length > maxChars) flush();
    current.push(para);
    currentLen = currentLen === 0 ? para.text.length : currentLen + 2 + para.text.length;
  }
  flush();

  return bodies.map((body, seq) => ({
    seq,
    content: `${header} ${body.text}`,
    page: pageAt(body.start, pageStarts),
  }));
}

/**
 * "[G.O.Ms.No.51 | Finance | 2025-04-15 | Dearness Allowance]" — unknown
 * fields render as "?" so the header shape stays parseable either way.
 */
function buildHeaderLine(header: ChunkInput["header"]): string {
  const field = (value: string | null): string => {
    // Metadata extraction can yield nulls; "?" keeps the slot visible so a
    // reader (human or LLM) sees the field is unknown, not omitted.
    if (value === null) return "?";
    const flat = value.replace(/\s+/g, " ").trim();
    if (flat === "") return "?";
    return flat.length > MAX_HEADER_FIELD_CHARS ? `${flat.slice(0, MAX_HEADER_FIELD_CHARS)}…` : flat;
  };
  const parts = [header.go_number, header.dept, header.issue_date, header.subject];
  return `[${parts.map(field).join(" | ")}]`;
}

/** Offsets where each page begins; index 0 = page 1. */
function computePageStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0c) starts.push(i + 1);
  }
  return starts;
}

/** 1-based page containing the given offset. */
function pageAt(offset: number, pageStarts: number[]): number {
  let page = 1;
  for (let i = 1; i < pageStarts.length; i++) {
    const start = pageStarts[i];
    if (start === undefined || offset < start) break;
    page = i + 1;
  }
  return page;
}

function splitParagraphs(text: string): Span[] {
  // First pass: blocks between blank lines / page breaks.
  const blocks: Span[] = [];
  let cursor = 0;
  for (const match of text.matchAll(PARA_BREAK)) {
    pushTrimmed(blocks, cursor, text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
  }
  pushTrimmed(blocks, cursor, text.slice(cursor));

  // Second pass: numbered-paragraph starts inside a block. Scanned GOs often
  // lose their blank lines, leaving "2." on a plain newline as the only
  // structural signal.
  const paras: Span[] = [];
  for (const block of blocks) {
    let from = 0;
    for (const match of block.text.matchAll(NUMBERED_PARA_START)) {
      // Cut after the newline so the number opens the next paragraph.
      const cut = match.index + 1;
      pushTrimmed(paras, block.start + from, block.text.slice(from, cut));
      from = cut;
    }
    pushTrimmed(paras, block.start + from, block.text.slice(from));
  }
  return paras;
}

/** Records a span with its start advanced past leading whitespace. */
function pushTrimmed(spans: Span[], start: number, raw: string): void {
  const text = raw.trim();
  if (text === "") return;
  const leading = raw.length - raw.trimStart().length;
  spans.push({ start: start + leading, text });
}

/**
 * Fuses a section heading with the paragraph after it, so "ORDER:" and the
 * order it introduces always travel in the same chunk.
 */
function attachHeadings(paras: Span[]): Span[] {
  const out: Span[] = [];
  for (let i = 0; i < paras.length; i++) {
    const para = paras[i];
    if (para === undefined) continue;
    const next = paras[i + 1];
    if (next !== undefined && SECTION_HEADING.test(para.text)) {
      out.push({ start: para.start, text: `${para.text}\n${next.text}` });
      i++;
      continue;
    }
    out.push(para);
  }
  return out;
}

/**
 * Splits a paragraph longer than maxChars into sentence-aligned pieces, each
 * seeded with up to overlapChars of the previous piece's tail.
 */
function splitOversize(para: Span, maxChars: number, overlapChars: number): Span[] {
  // Cap single sentences below maxChars minus the overlap budget (and the join
  // space) so seed + sentence can never overflow a piece.
  const units = sentenceUnits(para, Math.max(1, maxChars - overlapChars - 1));

  const pieces: Span[] = [];
  let seed: Span[] = [];
  let fresh: Span[] = [];
  for (const unit of units) {
    const pieceLen = joinedLength([...seed, ...fresh]);
    if (fresh.length > 0 && pieceLen + 1 + unit.text.length > maxChars) {
      const firstFresh = fresh[0];
      if (firstFresh !== undefined) {
        // The piece's page is where its own material starts — the seed is
        // repeated context and must not drag the citation to an earlier page.
        pieces.push({ start: firstFresh.start, text: joinUnits(seed, fresh) });
      }
      seed = tailUnits(fresh, overlapChars);
      fresh = [];
    }
    fresh.push(unit);
  }
  const firstFresh = fresh[0];
  if (firstFresh !== undefined) {
    pieces.push({ start: firstFresh.start, text: joinUnits(seed, fresh) });
  }
  return pieces;
}

/** Sentences of the paragraph; any sentence over maxUnitChars is char-sliced. */
function sentenceUnits(para: Span, maxUnitChars: number): Span[] {
  const units: Span[] = [];
  const push = (from: number, to: number) => {
    const raw = para.text.slice(from, to);
    const text = raw.trim();
    if (text === "") return;
    const start = para.start + from + (raw.length - raw.trimStart().length);
    // Tables and unpunctuated scans produce "sentences" of arbitrary length;
    // hard character slices are the fallback that keeps pieces bounded.
    for (let i = 0; i < text.length; i += maxUnitChars) {
      units.push({ start: start + i, text: text.slice(i, i + maxUnitChars) });
    }
  };

  let cursor = 0;
  for (const match of para.text.matchAll(SENTENCE_BOUNDARY)) {
    const end = match.index + match[0].length;
    push(cursor, end);
    cursor = end;
  }
  push(cursor, para.text.length);
  return units;
}

function joinUnits(seed: Span[], fresh: Span[]): string {
  return [...seed, ...fresh].map((unit) => unit.text).join(" ");
}

function joinedLength(units: Span[]): number {
  return units.reduce((sum, unit, i) => sum + unit.text.length + (i > 0 ? 1 : 0), 0);
}

/**
 * Whole sentences from the end of a piece totalling at most overlapChars —
 * or, when even the last sentence is too long, a raw character tail of it, so
 * consecutive pieces always share context.
 */
function tailUnits(units: Span[], overlapChars: number): Span[] {
  if (overlapChars === 0) return [];
  const tail: Span[] = [];
  let len = 0;
  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i];
    if (unit === undefined) continue;
    const addition = tail.length === 0 ? unit.text.length : unit.text.length + 1;
    if (len + addition > overlapChars) break;
    tail.unshift(unit);
    len += addition;
  }
  if (tail.length === 0) {
    const last = units[units.length - 1];
    if (last !== undefined) {
      const sliceLen = Math.min(overlapChars, last.text.length);
      tail.push({ start: last.start + last.text.length - sliceLen, text: last.text.slice(-sliceLen) });
    }
  }
  return tail;
}

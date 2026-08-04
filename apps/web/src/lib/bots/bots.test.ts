import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { daCommand, formatCitations } from "./shared";
import {
  intakeForwardedPdf,
  intakeReply,
  looksLikePdf,
  MAX_PDF_BYTES,
  sha256Hex,
} from "./ingest";
import { extractMessages, verifySignature } from "./whatsapp-protocol";
import { createHmac } from "node:crypto";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

interface FakeState {
  documents: Set<string>;
  inserted: Record<string, unknown>[];
  insertError?: { code?: string; message: string };
}

class FakeQuery {
  #table: string;
  #state: FakeState;
  #value = "";
  constructor(table: string, state: FakeState) {
    this.#table = table;
    this.#state = state;
  }
  select(): this {
    return this;
  }
  eq(_column: string, value: string): this {
    this.#value = value;
    return this;
  }
  async maybeSingle() {
    const known = this.#table === "documents" ? this.#state.documents : new Set<string>();
    return { data: known.has(this.#value) ? { id: "existing" } : null, error: null };
  }
  async insert(row: Record<string, unknown>) {
    if (this.#state.insertError) return { error: this.#state.insertError };
    this.#state.inserted.push(row);
    return { error: null };
  }
}

function makeDb(state: FakeState): SupabaseClient {
  return { from: (table: string) => new FakeQuery(table, state) } as unknown as SupabaseClient;
}

function makeState(overrides: Partial<FakeState> = {}): FakeState {
  return { documents: new Set(), inserted: [], ...overrides };
}

describe("looksLikePdf", () => {
  it("accepts a real PDF header", () => {
    expect(looksLikePdf(PDF)).toBe(true);
  });

  it("rejects anything else, whatever the sender claims it is", () => {
    // The declared content-type comes from a stranger; the bytes do not.
    expect(looksLikePdf(new TextEncoder().encode("<html>"))).toBe(false);
    expect(looksLikePdf(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false);
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });
});

describe("intakeForwardedPdf", () => {
  it("queues a forwarded PDF as pending, never approved", () => {
    // CLAUDE.md rule 6: nothing a stranger sends reaches the corpus unreviewed.
    const state = makeState();
    return intakeForwardedPdf(makeDb(state), {
      bytes: PDF,
      fileName: "go-60.pdf",
      mimeType: "application/pdf",
      from: "12345",
      source: "telegram",
    }).then((outcome) => {
      expect(outcome).toEqual({ status: "queued", sha256: sha256Hex(PDF) });
      expect(state.inserted[0]).toMatchObject({ source: "telegram", status: "pending" });
      const meta = state.inserted[0]?.meta as Record<string, unknown>;
      expect(String(meta.note)).toMatch(/verify against the official source/i);
      expect(meta.forwarded_by).toBe("12345");
    });
  });

  it("recognises a document already approved into the corpus", async () => {
    const state = makeState({ documents: new Set([sha256Hex(PDF)]) });

    const outcome = await intakeForwardedPdf(makeDb(state), {
      bytes: PDF,
      fileName: null,
      mimeType: null,
      from: "1",
      source: "whatsapp",
    });

    expect(outcome.status).toBe("duplicate");
    expect(state.inserted).toEqual([]);
  });

  it("treats a unique violation as a duplicate, not a crash", async () => {
    // Twenty people forwarding the same GO the morning it is signed is the
    // expected case, not an edge case.
    const state = makeState({ insertError: { code: "23505", message: "duplicate key" } });

    const outcome = await intakeForwardedPdf(makeDb(state), {
      bytes: PDF,
      fileName: null,
      mimeType: null,
      from: "1",
      source: "whatsapp",
    });

    expect(outcome.status).toBe("duplicate");
  });

  it("rejects a non-PDF, an empty file and an oversized one", async () => {
    const cases: [Uint8Array, RegExp][] = [
      [new TextEncoder().encode("<html>hi</html>"), /Only PDF/],
      [new Uint8Array(), /empty/],
      [new Uint8Array(MAX_PDF_BYTES + 1), /too large/],
    ];

    for (const [bytes, expected] of cases) {
      const outcome = await intakeForwardedPdf(makeDb(makeState()), {
        bytes,
        fileName: null,
        mimeType: "application/pdf",
        from: "1",
        source: "telegram",
      });

      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") expect(outcome.reason).toMatch(expected);
    }
  });
});

describe("intakeReply", () => {
  it("is honest that a human decides", () => {
    const reply = intakeReply({ status: "queued", sha256: "abc" });

    expect(reply).toMatch(/review/i);
    expect(reply).toMatch(/approve/i);
  });

  it("explains a rejection rather than going silent", () => {
    expect(intakeReply({ status: "rejected", reason: "The file was empty." })).toMatch(/empty/);
  });
});

describe("formatCitations", () => {
  const citation = {
    documentId: "d1",
    goNumber: "G.O.Ms.No.60",
    issueDate: "2025-10-20",
    subject: "DA",
    pdfUrl: "https://goir.ap.gov.in/60.pdf",
    supersededBy: null,
  };

  it("carries GO number, date and link into a plain-text chat", () => {
    // Rule 1 does not weaken because the answer arrived over WhatsApp.
    const text = formatCitations([citation]);

    expect(text).toContain("G.O.Ms.No.60");
    expect(text).toContain("dt 20.10.2025");
    expect(text).toContain("https://goir.ap.gov.in/60.pdf");
  });

  it("marks a superseded GO", () => {
    expect(formatCitations([{ ...citation, supersededBy: "newer" }])).toMatch(/superseded/);
  });

  it("adds nothing when there are no citations", () => {
    expect(formatCitations([])).toBe("");
  });
});

describe("daCommand", () => {
  const site = "https://ap-emp-ai.in";

  it("computes the arrears total and links to the full table", () => {
    // A month-wise table is unreadable in a chat bubble, so the bot gives the
    // number and points at the page.
    const reply = daCommand(["52590", "33.67", "2024-01", "2024-03"], site);

    expect(reply).toContain("₹5,742");
    expect(reply).toContain("G.O.Ms.No.60");
    expect(reply).toContain(`${site}/te/calculators/da-arrears`);
  });

  it("warns that the rates are unverified", () => {
    expect(daCommand(["52590", "33.67", "2024-01", "2024-03"], site)).toMatch(/not yet been verified/);
  });

  it("explains the usage instead of failing on bad input", () => {
    for (const args of [[], ["abc"], ["52590"], ["-1", "33", "2024-01", "2024-03"]]) {
      expect(daCommand(args, site), JSON.stringify(args)).toMatch(/Usage/);
    }
  });

  it("returns the calculator's own error when there is no rate for the period", () => {
    // Before 2018-07, which is where the seeded DA timeline begins. The
    // calculator refuses rather than extrapolating backwards.
    expect(daCommand(["52590", "20", "2017-01", "2017-03"], site)).toMatch(/No DA rate is on record/);
  });

  it("reports a recovery when the employee was paid more than was due", () => {
    // Negative arrears are real: an overpayment corrected after a revision.
    // The bot must show it rather than clamping to zero and hiding a debt.
    const reply = daCommand(["52590", "20", "2019-01", "2019-03"], site);

    expect(reply).toMatch(/-₹/);
  });
});

describe("WhatsApp webhook", () => {
  const secret = "app-secret";

  it("accepts a correctly signed body", () => {
    const body = '{"entry":[]}';
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    expect(verifySignature(body, signature, secret)).toBe(true);
  });

  it("rejects a forged, altered, missing or malformed signature", () => {
    const body = '{"entry":[]}';
    const valid = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    // Without this check anyone who learns the URL can inject documents into
    // the review queue and run up model costs.
    expect(verifySignature(body, valid, "wrong-secret")).toBe(false);
    expect(verifySignature('{"entry":[1]}', valid, secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha256=notxhex", secret)).toBe(false);
    expect(verifySignature(body, "deadbeef", secret)).toBe(false);
  });

  it("pulls messages out of Meta's nested envelope", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: "919999999999", id: "wamid.1", type: "text", text: { body: "DA?" } },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(extractMessages(payload)).toHaveLength(1);
    expect(extractMessages(payload)[0]?.text?.body).toBe("DA?");
  });

  it("returns [] for status callbacks and malformed payloads", () => {
    // Meta posts delivery receipts to the same URL; they carry no messages.
    expect(extractMessages({ entry: [{ changes: [{ value: { statuses: [] } }] }] })).toEqual([]);
    expect(extractMessages({})).toEqual([]);
    expect(extractMessages(null)).toEqual([]);
  });
});

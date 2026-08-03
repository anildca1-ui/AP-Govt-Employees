import { describe, expect, it } from "vitest";
import { sha256Hex } from "./dedupe.js";

describe("sha256Hex", () => {
  it("matches the known digest of the empty input", () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("gives the same digest for identical bytes from different sources", () => {
    const fromGoir = new TextEncoder().encode("%PDF-1.4 G.O.Ms.No.1");
    const fromWhatsApp = new TextEncoder().encode("%PDF-1.4 G.O.Ms.No.1");
    expect(sha256Hex(fromGoir)).toBe(sha256Hex(fromWhatsApp));
  });

  it("separates documents that differ by a single byte", () => {
    const a = new TextEncoder().encode("G.O.Ms.No.1");
    const b = new TextEncoder().encode("G.O.Ms.No.2");
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });
});

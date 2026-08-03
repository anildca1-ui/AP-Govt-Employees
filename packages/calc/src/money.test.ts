import { describe, expect, it } from "vitest";
import { formatINR, roundRupees } from "./money.js";

describe("roundRupees", () => {
  it("rounds 50 paise and above up", () => {
    expect(roundRupees(1234.5)).toBe(1235);
    expect(roundRupees(1234.49)).toBe(1234);
  });

  it("rounds a recovery away from zero, matching the positive-side rule", () => {
    expect(roundRupees(-1234.5)).toBe(-1235);
    expect(roundRupees(-1234.49)).toBe(-1234);
  });

  it("leaves whole rupees untouched", () => {
    expect(roundRupees(0)).toBe(0);
    expect(roundRupees(52590)).toBe(52590);
  });

  it("rejects non-finite input rather than emitting NaN into a pay bill", () => {
    expect(() => roundRupees(Number.NaN)).toThrow(RangeError);
    expect(() => roundRupees(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("formatINR", () => {
  it("groups in the Indian numbering system", () => {
    // 1,23,456 — not 123,456
    expect(formatINR(123456)).toBe("₹1,23,456");
  });

  it("shows paise only when asked", () => {
    expect(formatINR(52590.5, { paise: true })).toBe("₹52,590.50");
    expect(formatINR(52590.5)).toBe("₹52,591");
  });
});

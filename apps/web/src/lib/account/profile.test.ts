import { describe, expect, it } from "vitest";
import {
  CONSENT_POLICY_VERSION,
  profileToRow,
  rowToProfile,
  validateProfile,
} from "./profile";

describe("validateProfile", () => {
  it("accepts a complete profile", () => {
    const { profile, problems } = validateProfile({
      name: "Ramu",
      basicPay: "52590",
      scale: "20000-179000",
      dept: "School Education",
      joinDate: "2005-06-15",
      scheme: "CPS",
    });

    expect(problems).toEqual([]);
    expect(profile).toEqual({
      name: "Ramu",
      basicPay: 52590,
      scale: "20000-179000",
      dept: "School Education",
      joinDate: "2005-06-15",
      scheme: "CPS",
    });
  });

  it("accepts an entirely empty profile", () => {
    // The dashboard prefers a partial profile to a wall of required fields.
    const { profile, problems } = validateProfile({});

    expect(problems).toEqual([]);
    expect(profile.basicPay).toBeNull();
  });

  it("rejects a zero, negative or nonsense basic pay", () => {
    // Zero would silently produce zero arrears in every prefilled calculator.
    for (const bad of ["0", "-100", "abc"]) {
      const { problems } = validateProfile({ basicPay: bad });
      expect(problems.map((p) => p.field), bad).toContain("basicPay");
    }
  });

  it("flags an absurdly large basic pay as a probable typo", () => {
    const { problems } = validateProfile({ basicPay: "52590000" });
    expect(problems[0]?.message).toMatch(/typo/);
  });

  it("rejects an impossible joining date", () => {
    const { problems } = validateProfile({ joinDate: "2005-15-99" });
    expect(problems.map((p) => p.field)).toContain("joinDate");
  });

  it("rejects an unknown pension scheme rather than storing it", () => {
    const { problems } = validateProfile({ scheme: "EPS" });
    expect(problems.map((p) => p.field)).toContain("scheme");
  });

  it("trims whitespace and treats blank as absent", () => {
    const { profile } = validateProfile({ name: "  ", dept: "  Finance  " });
    expect(profile.name).toBeNull();
    expect(profile.dept).toBe("Finance");
  });
});

describe("profileToRow / rowToProfile", () => {
  it("round-trips a profile through the users row shape", () => {
    const { profile } = validateProfile({
      name: "Ramu",
      basicPay: "52590",
      scheme: "GPS",
      joinDate: "2005-06-15",
    });

    const row = profileToRow("user-1", profile);
    expect(row.id).toBe("user-1");
    expect(row.cps_or_ops).toBe("GPS");

    expect(rowToProfile(row)).toEqual(profile);
  });

  it("returns an empty profile for a missing row", () => {
    expect(rowToProfile(null).basicPay).toBeNull();
  });

  it("drops an invalid scheme read back from the database", () => {
    expect(rowToProfile({ cps_or_ops: "EPS" }).scheme).toBeNull();
  });
});

describe("consent bookkeeping", () => {
  it("pins a policy version, so 'what were they told' survives a rewrite", () => {
    expect(CONSENT_POLICY_VERSION).toMatch(/^\d{4}-\d{2}/);
  });
});

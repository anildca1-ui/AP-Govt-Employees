import { describe, expect, it } from "vitest";
import { findGoReference } from "./go-number.js";

describe("findGoReference", () => {
  it("reads the canonical spelling", () => {
    expect(findGoReference("What does G.O.Ms.No.51 say?")).toMatchObject({
      type: "Ms",
      number: 51,
      canonical: "G.O.Ms.No.51",
    });
  });

  it("tolerates the spacing and casing variants found in the corpus", () => {
    for (const variant of ["GO Ms No 51", "G.O.MS.No. 51", "g.o.ms.no.51", "G O Ms No.51"]) {
      expect(findGoReference(variant), variant).toMatchObject({
        type: "Ms",
        number: 51,
        canonical: "G.O.Ms.No.51",
      });
    }
  });

  it("recognises Rt orders as well as Ms", () => {
    expect(findGoReference("G.O.Rt.No.1234 dt 01.04.2025")).toMatchObject({
      type: "Rt",
      number: 1234,
      canonical: "G.O.Rt.No.1234",
    });
  });

  it("works inside a Telugu question", () => {
    expect(findGoReference("G.O.Ms.No.51 లో ఏమి ఉంది?")).toMatchObject({
      number: 51,
      canonical: "G.O.Ms.No.51",
    });
  });

  it("strips leading zeros so the lookup key is stable", () => {
    expect(findGoReference("G.O.Ms.No.051")?.canonical).toBe("G.O.Ms.No.51");
  });

  it("returns null for a plain question so retrieval takes the hybrid path", () => {
    expect(findGoReference("DA ఎంత శాతం పెరిగింది?")).toBeNull();
    expect(findGoReference("how do I calculate gratuity")).toBeNull();
  });

  it("does not match a bare number or a GO with no serial", () => {
    expect(findGoReference("order number 51")).toBeNull();
    expect(findGoReference("G.O.Ms.No.")).toBeNull();
  });
});

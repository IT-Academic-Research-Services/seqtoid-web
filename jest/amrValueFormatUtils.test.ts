// Frontend coverage: AmrSampleReport columnDefinitions/components/valueFormatUtils.ts
// holds the pure string/number formatting + sort comparators used to render and
// order the AMR results table. Every function here is deterministic, so cover
// each branch: tooltip gating, cutoff normalization/ordering, compound-string
// alphabetization, and the fallback-aware string sort.
import {
  getFormattedCompoundString,
  getFormattedCutoffStringValue,
  shouldShowTooltip,
  sortCutoffColumnFn,
  sortCutoffCompoundStringFn,
  sortStringOrFallback,
} from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/components/valueFormatUtils";

// NO_CONTENT_FALLBACK is "-" in the Table constants.
const FALLBACK = "-";

describe("shouldShowTooltip", () => {
  it("returns true for a non-numeric, non-fallback string", () => {
    expect(shouldShowTooltip("Perfect; Strict")).toBe(true);
  });

  it("returns false for a numeric string (can be parsed as a number)", () => {
    expect(shouldShowTooltip("42")).toBe(false);
    expect(shouldShowTooltip("3.14")).toBe(false);
  });

  it("returns false for the fallback dash", () => {
    expect(shouldShowTooltip(FALLBACK)).toBe(false);
  });

  it("treats empty string as numeric (Number('') === 0) so no tooltip", () => {
    // Documents the real behavior: Number("") is 0, not NaN.
    expect(shouldShowTooltip("")).toBe(false);
  });
});

describe("sortCutoffCompoundStringFn", () => {
  it("orders Perfect before Strict before Nudged before dash", () => {
    expect(sortCutoffCompoundStringFn("Perfect", "Strict")).toBeLessThan(0);
    expect(sortCutoffCompoundStringFn("Strict", "Nudged")).toBeLessThan(0);
    expect(sortCutoffCompoundStringFn("Nudged", "-")).toBeLessThan(0);
    expect(sortCutoffCompoundStringFn("Strict", "Perfect")).toBeGreaterThan(0);
  });

  it("returns 0 for equal values", () => {
    expect(sortCutoffCompoundStringFn("Perfect", "Perfect")).toBe(0);
  });
});

describe("getFormattedCutoffStringValue", () => {
  it("returns the fallback for an empty/falsy raw value", () => {
    expect(getFormattedCutoffStringValue("")).toBe(FALLBACK);
  });

  it("sorts a valid compound cutoff string into preferred order", () => {
    expect(getFormattedCutoffStringValue("Strict; Perfect")).toBe(
      "Perfect; Strict",
    );
  });

  it("trims whitespace around parts before sorting", () => {
    expect(getFormattedCutoffStringValue("  Nudged ;  Perfect ")).toBe(
      "Perfect; Nudged",
    );
  });

  it("returns the raw value unchanged when any part is not a known cutoff", () => {
    expect(getFormattedCutoffStringValue("Perfect; Bogus")).toBe(
      "Perfect; Bogus",
    );
  });

  it("handles a single valid value", () => {
    expect(getFormattedCutoffStringValue("Perfect")).toBe("Perfect");
  });
});

describe("sortCutoffColumnFn", () => {
  const row = (cutoff: string | null) => ({
    getValue: (columnId: string) =>
      columnId === "cutoff" ? cutoff : undefined,
  });

  it("ranks a row containing Perfect above one that does not", () => {
    // Perfect is earliest in the order: a has it, b does not -> a sorts after
    // b numerically is expressed as +1 per the implementation.
    expect(sortCutoffColumnFn(row("Perfect"), row("Strict"))).toBe(1);
    expect(sortCutoffColumnFn(row("Strict"), row("Perfect"))).toBe(-1);
  });

  it("uses the fallback when a cutoff value is missing", () => {
    // b is null -> becomes "-"; a is "Perfect". Perfect differentiates first.
    expect(sortCutoffColumnFn(row("Perfect"), row(null))).toBe(1);
    // a is null -> becomes "-"; b is "Perfect" -> b ranks higher (-1). This also
    // exercises the aVal fallback arm.
    expect(sortCutoffColumnFn(row(null), row("Perfect"))).toBe(-1);
    // both null -> both "-" -> no differentiator -> 0.
    expect(sortCutoffColumnFn(row(null), row(null))).toBe(0);
  });

  it("returns 0 when both rows share the same set of cutoff values", () => {
    expect(
      sortCutoffColumnFn(row("Perfect;Strict"), row("Strict;Perfect")),
    ).toBe(0);
  });

  it("differentiates on a later cutoff tier when earlier tiers match", () => {
    // Neither has Perfect; a has Strict, b does not -> a ranks higher (+1).
    expect(sortCutoffColumnFn(row("Strict"), row("Nudged"))).toBe(1);
  });
});

describe("getFormattedCompoundString", () => {
  it("alphabetizes a compound semicolon-separated string", () => {
    expect(getFormattedCompoundString("charlie; alpha; bravo")).toBe(
      "alpha; bravo; charlie",
    );
  });

  it("drops empty parts produced by trailing separators", () => {
    expect(getFormattedCompoundString("beta; ; alpha")).toBe("alpha; beta");
  });

  it("returns a numeric string unchanged", () => {
    expect(getFormattedCompoundString("123")).toBe("123");
  });

  it("returns non-string values unchanged", () => {
    expect(getFormattedCompoundString(null)).toBeNull();
    expect(getFormattedCompoundString(undefined)).toBeUndefined();
  });
});

describe("sortStringOrFallback", () => {
  const rows = (a: unknown, b: unknown) => {
    const aRow = { getValue: () => a };
    const bRow = { getValue: () => b };
    return [aRow, bRow] as const;
  };

  it("sorts a real value before a nil value", () => {
    const [aRow, bRow] = rows("gene", null);
    expect(sortStringOrFallback(aRow, bRow, "col")).toBe(-1);
  });

  it("sorts a nil value after a real value", () => {
    const [aRow, bRow] = rows(null, "gene");
    expect(sortStringOrFallback(aRow, bRow, "col")).toBe(1);
  });

  it("compares alphabetically, ignoring case", () => {
    expect(sortStringOrFallback(...arr("Apple", "banana"))).toBe(-1);
    expect(sortStringOrFallback(...arr("banana", "Apple"))).toBe(1);
  });

  it("returns 0 for case-insensitively equal values", () => {
    expect(sortStringOrFallback(...arr("Gene", "gene"))).toBe(0);
  });

  // Helper to pass a rows tuple plus the column id positionally.
  function arr(a: unknown, b: unknown) {
    const [aRow, bRow] = rows(a, b);
    return [aRow, bRow, "col"] as const;
  }
});

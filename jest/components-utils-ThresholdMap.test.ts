// Supplementary coverage for app/assets/src/components/utils/ThresholdMap.ts.
// jest/thresholdMap.test.ts already walks the happy paths of isThresholdValid,
// the localStorage round-trip, and the >= / <= comparison arms. What is left is
// (a) the constructor function itself, which is only used by legacy call sites,
// (b) the switch's `default:` arm -- a rule that is structurally VALID but whose
// operator is not one of the two supported comparisons, which must be ignored
// rather than rejecting the taxon, and (c) the contigs metric path, where the
// metric string splits into a type/title pair looked up via summaryContigCounts.
import ThresholdMap, {
  ThresholdConditions,
} from "~/components/utils/ThresholdMap";

const makeThreshold = (
  over: Partial<ThresholdConditions> = {},
): ThresholdConditions => ({
  metric: "nt_zscore",
  operator: ">=",
  value: "1",
  metricDisplay: "NT Z Score",
  ...over,
});

describe("ThresholdMap constructor", () => {
  it("stores the options it was constructed with", () => {
    const options = { thresholds: [makeThreshold()] };
    const instance = new (ThresholdMap as any)(options);

    expect(instance.options).toBe(options);
    expect(instance).toBeInstanceOf(ThresholdMap as any);
  });

  it("stores undefined when constructed with no options", () => {
    const instance = new (ThresholdMap as any)();
    expect(instance.options).toBeUndefined();
  });
});

describe("ThresholdMap.isThresholdValid extra cases", () => {
  it("is false when the operator is missing", () => {
    expect(
      ThresholdMap.isThresholdValid({
        metric: "nt_zscore",
        value: "1",
      } as ThresholdConditions),
    ).toBe(false);
  });

  it("is false when the value is missing entirely", () => {
    expect(
      ThresholdMap.isThresholdValid({
        metric: "nt_zscore",
        operator: ">=",
      } as ThresholdConditions),
    ).toBe(false);
  });

  it("is false for an empty-string metric (falsy, short-circuits the guard)", () => {
    expect(ThresholdMap.isThresholdValid(makeThreshold({ metric: "" }))).toBe(
      false,
    );
  });

  it("accepts negative and decimal values", () => {
    expect(
      ThresholdMap.isThresholdValid(makeThreshold({ value: "-2.5" })),
    ).toBe(true);
  });
});

describe("ThresholdMap.taxonPassThresholdFilter extra cases", () => {
  const taxon = { nt: { zscore: 5 } };

  it("passes a taxon when there are no rules at all", () => {
    expect(ThresholdMap.taxonPassThresholdFilter(taxon, [])).toBe(true);
  });

  it("ignores a rule whose operator is not >= or <= (default switch arm)", () => {
    // Structurally valid (all three fields present, numeric value) so it gets
    // past isThresholdValid, but "==" is not a supported comparison: the taxon
    // must still pass rather than being filtered out.
    const bogus = makeThreshold({ operator: "==" as any, value: "999" });
    expect(ThresholdMap.isThresholdValid(bogus)).toBe(true);
    expect(ThresholdMap.taxonPassThresholdFilter(taxon, [bogus])).toBe(true);
  });

  it("requires EVERY rule to pass (AND semantics)", () => {
    const passes = makeThreshold({ value: "1" });
    const fails = makeThreshold({ value: "100" });
    expect(ThresholdMap.taxonPassThresholdFilter(taxon, [passes, fails])).toBe(
      false,
    );
    expect(ThresholdMap.taxonPassThresholdFilter(taxon, [passes, passes])).toBe(
      true,
    );
  });

  it("treats a boundary value as passing for both operators", () => {
    expect(
      ThresholdMap.taxonPassThresholdFilter(taxon, [
        makeThreshold({ operator: ">=", value: "5" }),
      ]),
    ).toBe(true);
    expect(
      ThresholdMap.taxonPassThresholdFilter(taxon, [
        makeThreshold({ operator: "<=", value: "5" }),
      ]),
    ).toBe(true);
  });

  it("reads contig metrics out of summaryContigCounts", () => {
    const contigTaxon = { summaryContigCounts: { nt: { contigs: 4 } } };
    expect(
      ThresholdMap.taxonPassThresholdFilter(contigTaxon, [
        makeThreshold({ metric: "nt_contigs", value: "4" }),
      ]),
    ).toBe(true);
    expect(
      ThresholdMap.taxonPassThresholdFilter(contigTaxon, [
        makeThreshold({ metric: "nt_contigs", value: "5" }),
      ]),
    ).toBe(false);
  });

  it("defaults a missing contig count to 0", () => {
    const contigTaxon = { summaryContigCounts: {} };
    expect(
      ThresholdMap.taxonPassThresholdFilter(contigTaxon, [
        makeThreshold({ metric: "nr_contigs", operator: "<=", value: "0" }),
      ]),
    ).toBe(true);
  });
});

describe("ThresholdMap.saveThresholdFilters extra cases", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("writes an empty list when every threshold is invalid", () => {
    ThresholdMap.saveThresholdFilters([makeThreshold({ value: "abc" })]);
    expect(window.localStorage.getItem("activeThresholds")).toBe("[]");
    expect(ThresholdMap.getSavedThresholdFilters()).toEqual([]);
  });

  it("overwrites any previously saved list", () => {
    const first = makeThreshold({ value: "1" });
    const second = makeThreshold({ value: "2" });
    ThresholdMap.saveThresholdFilters([first]);
    ThresholdMap.saveThresholdFilters([second]);
    expect(ThresholdMap.getSavedThresholdFilters()).toEqual([second]);
  });
});

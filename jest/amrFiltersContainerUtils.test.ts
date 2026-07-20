// Frontend coverage: AmrFiltersContainer/utils.ts exposes getAmrColumnTransform
// (maps a ColumnId to an accessor over an AmrResult row) and countActiveFilters
// (tallies how many filters are active across threshold/single/multiple types).
// Both are pure; cover the rpm/dpm special cases, the numeric-parse fallback,
// and each filter-type branch including the null/default guards.
import {
  countActiveFilters,
  getAmrColumnTransform,
} from "~/components/views/SampleView/components/AmrView/components/AmrFiltersContainer/utils";
import { ColumnId } from "~/components/views/SampleView/components/AmrView/constants";

describe("getAmrColumnTransform", () => {
  it("reads rpm directly for the reads-per-million column", () => {
    const transform = getAmrColumnTransform(ColumnId.READS_PER_MILLION);
    expect(transform({ rpm: 12.5 } as any)).toBe(12.5);
  });

  it("reads dpm directly for the read-depth-per-million column", () => {
    const transform = getAmrColumnTransform(ColumnId.READ_DEPTH_PER_MILLION);
    expect(transform({ dpm: 3 } as any)).toBe(3);
  });

  it("parses a string column value as a float for other columns", () => {
    const transform = getAmrColumnTransform(ColumnId.CONTIG_PERCENT_ID);
    expect(transform({ [ColumnId.CONTIG_PERCENT_ID]: "99.7" } as any)).toBe(
      99.7,
    );
  });

  it("returns null when the other-column value is missing/falsy", () => {
    const transform = getAmrColumnTransform(ColumnId.CONTIG_PERCENT_ID);
    expect(transform({ [ColumnId.CONTIG_PERCENT_ID]: "" } as any)).toBeNull();
    expect(transform({} as any)).toBeNull();
  });
});

describe("countActiveFilters", () => {
  it("returns 0 for a nil filter set", () => {
    expect(countActiveFilters(undefined as any)).toBe(0);
    expect(countActiveFilters(null as any)).toBe(0);
  });

  it("counts each threshold filter entry", () => {
    const filters = {
      a: { type: "threshold", params: { thresholdFilters: [{}, {}] } },
    };
    expect(countActiveFilters(filters as any)).toBe(2);
  });

  it("counts a single filter as 1 when selected, 0 otherwise", () => {
    expect(
      countActiveFilters({
        a: { type: "single", params: { selected: "x" } },
      } as any),
    ).toBe(1);
    expect(
      countActiveFilters({
        a: { type: "single", params: { selected: null } },
      } as any),
    ).toBe(0);
  });

  it("counts the length of a multiple filter's selection", () => {
    expect(
      countActiveFilters({
        a: { type: "multiple", params: { multiSelected: ["x", "y", "z"] } },
      } as any),
    ).toBe(3);
  });

  it("treats a multiple filter with no selection as zero", () => {
    expect(
      countActiveFilters({ a: { type: "multiple", params: {} } } as any),
    ).toBe(0);
  });

  it("ignores unknown filter types via the default branch", () => {
    expect(
      countActiveFilters({ a: { type: "mystery", params: {} } } as any),
    ).toBe(0);
  });

  it("sums across a mix of filter types", () => {
    const filters = {
      t: { type: "threshold", params: { thresholdFilters: [{}] } },
      s: { type: "single", params: { selected: "on" } },
      m: { type: "multiple", params: { multiSelected: ["a", "b"] } },
      d: { type: "other", params: {} },
    };
    expect(countActiveFilters(filters as any)).toBe(4);
  });

  it("treats missing params arrays as zero contributions", () => {
    expect(
      countActiveFilters({ a: { type: "threshold", params: {} } } as any),
    ).toBe(0);
  });
});

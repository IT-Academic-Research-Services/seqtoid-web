// Coverage for app/assets/src/components/views/SampleView/utils/filters.ts
//
// filters.ts is the report-table filtering engine: a chain of small predicates
// (taxa / annotations / pathogen flags / categories / read specificity /
// thresholds) applied to every genus row and every species row. The public
// surface is filterReportData, adjustMetricPrecision and setDisplayName, so the
// private predicates are reached by driving filterReportData with report rows
// that isolate one predicate at a time -- each with a passing AND a failing
// case so both arms of every conditional are taken.
import { WORKFLOW_TABS } from "~/components/utils/workflows";
import {
  adjustMetricPrecision,
  filterReportData,
  setDisplayName,
} from "~/components/views/SampleView/utils/filters";

const SHORT_READ_TAB = WORKFLOW_TABS.SHORT_READ_MNGS;
const LONG_READ_TAB = WORKFLOW_TABS.LONG_READ_MNGS;

// A filter selection object where nothing is filtering anything out.
const noFilters = () => ({
  categories: { categories: [], subcategories: {} },
  thresholdsShortReads: [],
  thresholdsLongReads: [],
  readSpecificity: false,
  taxa: [],
  annotations: [],
  flags: [],
});

// Minimal genus row with one species child.
const makeGenus = (genus: any = {}, species: any = {}) => ({
  taxId: 100,
  genus_tax_id: 100,
  taxLevel: "genus",
  category: "bacteria",
  name: "Genus name",
  common_name: "genus common",
  species: [
    {
      taxId: 200,
      genus_tax_id: 100,
      taxLevel: "species",
      category: "bacteria",
      name: "Species name",
      common_name: "species common",
      ...species,
    },
  ],
  ...genus,
});

const run = (reportData: any[], filters: any, tab: any = SHORT_READ_TAB) =>
  filterReportData({
    currentTab: tab as any,
    reportData: reportData as any,
    filters: { ...noFilters(), ...filters } as any,
  });

describe("filterReportData - no filters", () => {
  it("keeps every genus and species when no filter is set", () => {
    const rows = [makeGenus()];
    const result = run(rows, {});
    expect(result).toHaveLength(1);
    expect(result[0].passedFilters).toBe(true);
    expect(result[0].filteredSpecies).toHaveLength(1);
  });
});

describe("filterReportData - taxa filter", () => {
  it("keeps a row whose taxId matches a selected taxon", () => {
    const result = run([makeGenus()], { taxa: [{ id: 100 }] });
    expect(result).toHaveLength(1);
    expect(result[0].passedFilters).toBe(true);
    // Species matches through genus_tax_id.
    expect(result[0].filteredSpecies).toHaveLength(1);
  });

  it("drops rows that match no selected taxon", () => {
    const result = run([makeGenus()], { taxa: [{ id: 999 }] });
    expect(result).toHaveLength(0);
  });

  it("keeps a species whose own taxId matches even when the genus does not", () => {
    const rows = [makeGenus({ taxId: 100, genus_tax_id: 100 })];
    const result = run(rows, { taxa: [{ id: 200 }] });
    expect(result).toHaveLength(1);
    expect(result[0].passedFilters).toBe(false);
    expect(result[0].filteredSpecies).toHaveLength(1);
  });
});

describe("filterReportData - annotation filter", () => {
  it("matches annotations case/format insensitively via snake case", () => {
    const rows = [
      makeGenus({ annotation: "not_a_hit" }, { annotation: "not_a_hit" }),
    ];
    const result = run(rows, { annotations: ["Not a hit"] });
    expect(result).toHaveLength(1);
    expect(result[0].passedFilters).toBe(true);
  });

  it("drops rows whose annotation is not selected", () => {
    const rows = [makeGenus({ annotation: "hit" }, { annotation: "hit" })];
    const result = run(rows, { annotations: ["Inconclusive"] });
    expect(result).toHaveLength(0);
  });
});

describe("filterReportData - pathogen flag filter", () => {
  it("keeps a species carrying the selected flag and drops one that does not", () => {
    const rows = [
      makeGenus(
        { pathogens: { knownPathogen: 1 } },
        { pathogenFlags: ["knownPathogen"] },
      ),
      makeGenus(
        { taxId: 300, genus_tax_id: 300, pathogens: {} },
        { taxId: 400, genus_tax_id: 300, pathogenFlags: [] },
      ),
    ];
    const result = run(rows, { flags: ["knownPathogen"] });
    expect(result).toHaveLength(1);
    expect(result[0].taxId).toBe(100);
    expect(result[0].filteredSpecies).toHaveLength(1);
  });

  it("treats a genus with no pathogens object as carrying no flags", () => {
    const rows = [makeGenus({ pathogens: undefined })];
    const result = run(rows, { flags: ["knownPathogen"] });
    expect(result).toHaveLength(0);
  });

  it("recomputes genus pathogen counts from the surviving species", () => {
    const rows = [
      makeGenus({}, { pathogenFlags: ["knownPathogen", "divergent"] }),
    ];
    rows[0].species.push({
      taxId: 201,
      genus_tax_id: 100,
      taxLevel: "species",
      category: "bacteria",
      name: "Second species",
      common_name: "second",
      pathogenFlags: ["knownPathogen"],
    } as any);
    const result = run(rows, {});
    expect(result[0].pathogens).toEqual({ knownPathogen: 2, divergent: 1 });
  });
});

describe("filterReportData - category filter", () => {
  it("keeps rows in a selected category", () => {
    const result = run([makeGenus()], {
      categories: { categories: ["Bacteria"], subcategories: {} },
    });
    expect(result).toHaveLength(1);
  });

  it("drops rows outside the selected category", () => {
    const result = run([makeGenus()], {
      categories: { categories: ["Viruses"], subcategories: {} },
    });
    expect(result).toHaveLength(0);
  });

  it("keeps a row whose subcategory is selected even when its category is not", () => {
    const rows = [
      makeGenus({ subcategories: ["phage"] }, { subcategories: ["phage"] }),
    ];
    const result = run(rows, {
      categories: { categories: [], subcategories: { Viruses: ["Phage"] } },
    });
    expect(result).toHaveLength(1);
    expect(result[0].passedFilters).toBe(true);
  });

  it("drops a row in the selected category when it has an unselected subcategory", () => {
    const rows = [
      makeGenus(
        { category: "viruses", subcategories: ["phage"] },
        { category: "viruses", subcategories: ["phage"] },
      ),
    ];
    const result = run(rows, {
      categories: { categories: ["Viruses"], subcategories: {} },
    });
    expect(result).toHaveLength(0);
  });

  it("maps a null category onto the 'uncategorized' selection", () => {
    const rows = [makeGenus({ category: null }, { category: null })];
    const result = run(rows, {
      categories: { categories: ["Uncategorized"], subcategories: {} },
    });
    expect(result).toHaveLength(1);
    expect(result[0].passedFilters).toBe(true);
  });
});

describe("filterReportData - read specificity", () => {
  it("drops genus rows with a non-positive taxId when specificity is on", () => {
    const rows = [
      makeGenus(
        { taxId: -200, genus_tax_id: -200 },
        { taxId: 210, genus_tax_id: -200 },
      ),
    ];
    const result = run(rows, { readSpecificity: true });
    expect(result).toHaveLength(0);
  });

  it("keeps positive-taxId rows when specificity is on", () => {
    const result = run([makeGenus()], { readSpecificity: true });
    expect(result).toHaveLength(1);
    expect(result[0].passedFilters).toBe(true);
  });
});

describe("filterReportData - thresholds", () => {
  const withCounts = () =>
    makeGenus(
      { nt: { count: 50, e_value: -90 } },
      { nt: { count: 50, e_value: -90 } },
    );

  it(">= threshold keeps rows at or above the value", () => {
    const result = run([withCounts()], {
      thresholdsShortReads: [
        { metric: "nt:count", operator: ">=", value: "10" },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].passedFilters).toBe(true);
  });

  it(">= threshold drops rows below the value", () => {
    const result = run([withCounts()], {
      thresholdsShortReads: [
        { metric: "nt:count", operator: ">=", value: "1000" },
      ],
    });
    expect(result).toHaveLength(0);
  });

  it("<= threshold drops rows above the value", () => {
    const result = run([withCounts()], {
      thresholdsShortReads: [
        { metric: "nt:count", operator: "<=", value: "5" },
      ],
    });
    expect(result).toHaveLength(0);
  });

  it("<= threshold keeps rows at or below the value", () => {
    const result = run([withCounts()], {
      thresholdsShortReads: [
        { metric: "nt:count", operator: "<=", value: "500" },
      ],
    });
    expect(result).toHaveLength(1);
  });

  it("an unknown operator is a no-op that keeps the row", () => {
    const result = run([withCounts()], {
      thresholdsShortReads: [
        { metric: "nt:count", operator: "==", value: "1" },
      ],
    });
    expect(result).toHaveLength(1);
  });

  it("treats e_value thresholds as base-10 exponents", () => {
    // Row e_value is -90 => 10^-90. A <= threshold of -50 (10^-50) passes.
    const passing = run([withCounts()], {
      thresholdsShortReads: [
        { metric: "nt:e_value", operator: "<=", value: "-50" },
      ],
    });
    expect(passing).toHaveLength(1);

    const failing = run([withCounts()], {
      thresholdsShortReads: [
        { metric: "nt:e_value", operator: ">=", value: "-50" },
      ],
    });
    expect(failing).toHaveLength(0);
  });

  it("treats a missing metric as 0", () => {
    const result = run([makeGenus()], {
      thresholdsShortReads: [
        { metric: "nt:count", operator: ">=", value: "1" },
      ],
    });
    expect(result).toHaveLength(0);
  });

  it("uses the long-read thresholds on the long-read tab", () => {
    const rows = [
      makeGenus({ nt: { bpm: 5 } }, { nt: { bpm: 5 } }),
      makeGenus(
        { taxId: 300, genus_tax_id: 300, nt: { bpm: 500 } },
        { taxId: 400, genus_tax_id: 300, nt: { bpm: 500 } },
      ),
    ];
    const result = run(
      rows,
      {
        // The short-read list must be ignored on this tab.
        thresholdsShortReads: [
          { metric: "nt:bpm", operator: ">=", value: "100000" },
        ],
        thresholdsLongReads: [
          { metric: "nt:bpm", operator: ">=", value: "100" },
        ],
      },
      LONG_READ_TAB,
    );
    expect(result).toHaveLength(1);
    expect(result[0].taxId).toBe(300);
  });
});

describe("adjustMetricPrecision", () => {
  it("returns the input unchanged for null/undefined", () => {
    expect(adjustMetricPrecision(null)).toBeNull();
    expect(adjustMetricPrecision(undefined)).toBeUndefined();
  });

  it("rounds top-level metrics to their configured decimal places", () => {
    const species = { agg_score: 12.6789, rpm: 3.14159, unrelated: 9.87654 };
    const result = adjustMetricPrecision(species);
    expect(result.agg_score).toBe(13);
    expect(result.rpm).toBe(3.1);
    // Not in METRIC_DECIMAL_PLACES -- untouched.
    expect(result.unrelated).toBe(9.87654);
  });

  it("skips nil metric values instead of coercing them to 0", () => {
    const species = { agg_score: null, rpm: undefined };
    const result = adjustMetricPrecision(species);
    expect(result.agg_score).toBeNull();
    expect(result.rpm).toBeUndefined();
  });

  it("recurses into the nt/nr count-type objects", () => {
    const species = {
      nt: { count: 10.9, percent_identity: 98.765, unknown: 1.23456 },
      nr: { rpm: 0.0 },
    };
    const result = adjustMetricPrecision(species);
    expect(result.nt.count).toBe(11);
    expect(result.nt.percent_identity).toBe(98.8);
    expect(result.nt.unknown).toBe(1.23456);
    // Falsy metric value -- left alone.
    expect(result.nr.rpm).toBe(0);
  });

  it("tolerates a nil nt/nr sub-object", () => {
    const species = { nt: null, nr: undefined };
    const result = adjustMetricPrecision(species);
    expect(result.nt).toBeNull();
    expect(result.nr).toBeUndefined();
  });
});

describe("setDisplayName", () => {
  it("uses scientific names when nameType is 'Scientific name'", () => {
    const reportData = [makeGenus()] as any;
    setDisplayName({ reportData, nameType: "Scientific name" });
    expect(reportData[0].displayName).toBe("Genus name");
    expect(reportData[0].species[0].displayName).toBe("Species name");
  });

  it("uses common names for any other nameType", () => {
    const reportData = [makeGenus()] as any;
    setDisplayName({ reportData, nameType: "Common name" });
    expect(reportData[0].displayName).toBe("genus common");
    expect(reportData[0].species[0].displayName).toBe("species common");
  });

  it("does not throw when reportData or genus.species is missing", () => {
    expect(() =>
      setDisplayName({ reportData: undefined as any, nameType: "Common name" }),
    ).not.toThrow();
    const sparse = [{ name: "g", common_name: "gc" }] as any;
    setDisplayName({ reportData: sparse, nameType: "Scientific name" });
    expect(sparse[0].displayName).toBe("g");
  });
});

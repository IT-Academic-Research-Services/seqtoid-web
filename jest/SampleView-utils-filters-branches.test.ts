// Remaining branch coverage for app/assets/src/components/views/SampleView/utils/filters.ts.
//
// Three conditionals in the filtering engine still had an untaken arm:
//   * filterFlags' `else if (row.taxLevel === "species")` -- the implicit else,
//     taken by any row that is neither a genus nor a species row.
//   * filterThresholds' `Math.pow(10, parsedValue) || 0` -- the `|| 0` fallback,
//     taken when an e_value threshold is applied to a row that has no such metric
//     (Math.pow(10, undefined) is NaN, which is falsy).
//   * filterReportData's `categories.categories || []` -- the `|| []` fallback,
//     taken when the caller's category selection object omits `categories`.
import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { filterReportData } from "~/components/views/SampleView/utils/filters";

const SHORT_READ_TAB = WORKFLOW_TABS.SHORT_READ_MNGS;

const noFilters = () => ({
  categories: { categories: [], subcategories: {} },
  thresholdsShortReads: [],
  thresholdsLongReads: [],
  readSpecificity: false,
  taxa: [],
  annotations: [],
  flags: [],
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (reportData: any[], filters: any, tab: any = SHORT_READ_TAB) =>
  filterReportData({
    currentTab: tab as any,
    reportData: reportData as any,
    filters: { ...noFilters(), ...filters } as any,
  });
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("filterFlags with a row that is neither genus nor species", () => {
  it("collects no flags for an unrecognised taxLevel, so the row fails the flag filter", () => {
    // taxLevel "family" hits neither the `genus` branch nor the `species`
    // branch, so rowFlags stays empty and no selected flag can match.
    const rows = [
      {
        taxId: 100,
        genus_tax_id: 100,
        taxLevel: "family",
        category: "bacteria",
        name: "Enterobacteriaceae",
        // Both flag sources are populated: neither is read for this taxLevel.
        pathogens: { knownPathogen: 1 },
        pathogenFlags: ["knownPathogen"],
        species: [
          {
            taxId: 200,
            genus_tax_id: 100,
            taxLevel: "species",
            category: "bacteria",
            name: "Escherichia coli",
            pathogenFlags: ["knownPathogen"],
          },
        ],
      },
    ];

    const result = run(rows, { flags: ["knownPathogen"] });

    // The row survives only because one of its species passed.
    expect(result).toHaveLength(1);
    expect(result[0].passedFilters).toBe(false);
    expect(result[0].filteredSpecies).toHaveLength(1);
  });

  it("drops the row entirely when its species are also unflagged", () => {
    const rows = [
      {
        taxId: 100,
        genus_tax_id: 100,
        taxLevel: "family",
        category: "bacteria",
        name: "Enterobacteriaceae",
        pathogens: { knownPathogen: 1 },
        species: [
          {
            taxId: 200,
            genus_tax_id: 100,
            taxLevel: "species",
            category: "bacteria",
            name: "Escherichia coli",
            pathogenFlags: [],
          },
        ],
      },
    ];

    expect(run(rows, { flags: ["knownPathogen"] })).toHaveLength(0);
  });
});

describe("filterThresholds e_value fallback", () => {
  const eValueRows = (nt: Record<string, unknown> | undefined) => [
    {
      taxId: 100,
      genus_tax_id: 100,
      taxLevel: "genus",
      category: "bacteria",
      name: "Genus",
      ...(nt ? { nt } : {}),
      species: [
        {
          taxId: 200,
          genus_tax_id: 100,
          taxLevel: "species",
          category: "bacteria",
          name: "Species",
          ...(nt ? { nt } : {}),
        },
      ],
    },
  ];

  it("treats a row with no nt.e_value as 0, failing a `>=` e_value threshold", () => {
    // Math.pow(10, undefined) === NaN -> falsy -> rowValue falls back to 0,
    // and 10^-10 <= 0 is false.
    const result = run(eValueRows(undefined), {
      thresholdsShortReads: [
        { metric: "nt:e_value", operator: ">=", value: "-10" },
      ],
    });

    expect(result).toHaveLength(0);
  });

  it("passes the same threshold once the row actually carries nt.e_value", () => {
    const result = run(eValueRows({ e_value: -5 }), {
      thresholdsShortReads: [
        { metric: "nt:e_value", operator: ">=", value: "-10" },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].passedFilters).toBe(true);
  });

  it("keeps the 0 fallback usable for a `<=` e_value threshold", () => {
    // Same missing-metric row, but now 10^-10 >= 0 is true, so nothing is
    // filtered out -- proving the fallback value is 0 and not NaN.
    const result = run(eValueRows(undefined), {
      thresholdsShortReads: [
        { metric: "nt:e_value", operator: "<=", value: "-10" },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].passedFilters).toBe(true);
  });
});

describe("filterReportData with a category selection missing `categories`", () => {
  it("falls back to an empty category set instead of throwing", () => {
    const rows = [
      {
        taxId: 100,
        genus_tax_id: 100,
        taxLevel: "genus",
        category: "bacteria",
        name: "Genus",
        species: [
          {
            taxId: 200,
            genus_tax_id: 100,
            taxLevel: "species",
            category: "bacteria",
            name: "Species",
          },
        ],
      },
    ];

    // `categories.categories` is absent -> `|| []` -> empty set -> the category
    // filter is a no-op and every row survives.
    const result = run(rows, { categories: { subcategories: {} } });

    expect(result).toHaveLength(1);
    expect(result[0].passedFilters).toBe(true);
    expect(result[0].filteredSpecies).toHaveLength(1);
  });

  it("still filters by category when the selection does provide one", () => {
    const rows = [
      {
        taxId: 100,
        genus_tax_id: 100,
        taxLevel: "genus",
        category: "bacteria",
        name: "Genus",
        species: [
          {
            taxId: 200,
            genus_tax_id: 100,
            taxLevel: "species",
            category: "bacteria",
            name: "Species",
          },
        ],
      },
    ];

    expect(
      run(rows, { categories: { categories: ["Viruses"], subcategories: {} } }),
    ).toHaveLength(0);
  });
});

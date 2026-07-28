// Supplemental branch coverage for app/assets/src/components/utils/csv.ts.
//
// jest/utilsCsv.test.ts and jest/components-utils-csv.test.ts already cover the
// happy paths. This file targets the conditional arms those suites leave cold
// inside createCSVRowForAppliedFilters (the categories/subcategories shape
// permutations, the empty-collection guards, the unknown-filter default arm,
// the singular/plural filter counter) and inside the pathogen-flag decoration
// used by computeMngsReportTableValuesForCSV.
import {
  computeMngsReportTableValuesForCSV,
  createCSVRowForAppliedFilters,
} from "~/components/utils/csv";
import { WORKFLOW_TABS } from "~/components/utils/workflows";

// The util returns a one-element array holding the whole comma-joined row.
const rowText = (row: string[]) => row[0];

describe("createCSVRowForAppliedFilters branch coverage", () => {
  it("emits only the subcategory line when the categories key is absent", () => {
    const row = createCSVRowForAppliedFilters(
      {
        categories: { subcategories: { Viruses: ["Phage"] } },
      } as $TSFixMe,
      [],
      {} as $TSFixMe,
    );

    const text = rowText(row);
    expect(text).toContain("Categories:");
    expect(text).toContain("Viruses - Phage");
    // One subcategory entry, no top-level categories -> singular counter.
    expect(text).toContain("1 Filter Applied:");
  });

  it("emits only the category line when the subcategories key is absent", () => {
    const row = createCSVRowForAppliedFilters(
      { categories: { categories: ["viruses", "bacteria"] } } as $TSFixMe,
      [],
      {} as $TSFixMe,
    );

    const text = rowText(row);
    expect(text).toContain("Categories:");
    expect(text).toContain("viruses");
    expect(text).toContain("bacteria");
    // Two categories -> plural counter.
    expect(text).toContain("2 Filters Applied:");
  });

  it("drops subcategories whose value list is empty", () => {
    const row = createCSVRowForAppliedFilters(
      {
        categories: {
          categories: ["viruses"],
          subcategories: { Viruses: [], Bacteria: ["Phage"] },
        },
      } as $TSFixMe,
      [],
      {} as $TSFixMe,
    );

    const text = rowText(row);
    expect(text).toContain("Bacteria - Phage");
    expect(text).not.toContain("Viruses - ");
    // 1 category + 1 non-empty subcategory.
    expect(text).toContain("2 Filters Applied:");
  });

  it("omits the Categories line entirely when both collections are empty", () => {
    const row = createCSVRowForAppliedFilters(
      { categories: { categories: [], subcategories: {} } } as $TSFixMe,
      [],
      {} as $TSFixMe,
    );

    const text = rowText(row);
    expect(text).not.toContain("Categories:");
    expect(text).toContain("0 Filter Applied:");
  });

  it("omits the Thresholds line for an empty threshold list", () => {
    const row = createCSVRowForAppliedFilters(
      { thresholdsShortReads: [] } as $TSFixMe,
      [],
      {} as $TSFixMe,
    );

    const text = rowText(row);
    expect(text).not.toContain("Thresholds:");
    expect(text).toContain("0 Filter Applied:");
  });

  it("counts each long-read threshold and joins them onto one line", () => {
    const row = createCSVRowForAppliedFilters(
      {
        thresholdsLongReads: [
          { metricDisplay: "bPM", operator: ">=", value: 10 },
          { metricDisplay: "Bases", operator: "<=", value: 500 },
        ],
      } as $TSFixMe,
      [],
      {} as $TSFixMe,
    );

    const text = rowText(row);
    expect(text).toContain("Thresholds:");
    expect(text).toContain("bPM >= 10");
    expect(text).toContain("Bases <= 500");
    expect(text).toContain("2 Filters Applied:");
  });

  it("ignores a filter name it has no descriptor for", () => {
    const row = createCSVRowForAppliedFilters(
      { annotations: ["hit"] } as $TSFixMe,
      [],
      {} as $TSFixMe,
    );

    const text = rowText(row);
    expect(text).not.toContain("annotations");
    expect(text).toContain("0 Filter Applied:");
  });

  it("keeps the filter counter ahead of the filter lines but behind the background", () => {
    const row = createCSVRowForAppliedFilters(
      { taxa: [{ name: "Klebsiella" }, { name: "E. coli" }] } as $TSFixMe,
      [{ id: 3, name: "Idseq Human CSF" }],
      { background: 3 } as $TSFixMe,
    );

    const text = rowText(row);
    const backgroundAt = text.indexOf("Background:");
    const counterAt = text.indexOf("2 Filters Applied:");
    const firstTaxonAt = text.indexOf("Taxon Name:");
    expect(backgroundAt).toBeGreaterThanOrEqual(0);
    expect(counterAt).toBeGreaterThan(backgroundAt);
    expect(firstTaxonAt).toBeGreaterThan(counterAt);
  });

  it("strips leading formula characters from the assembled filter row", () => {
    const row = createCSVRowForAppliedFilters(
      { flags: ["=cmd|calc"] } as $TSFixMe,
      [],
      {} as $TSFixMe,
    );

    const text = rowText(row);
    // Only leading characters of a cell are stripped; the payload survives.
    expect(text).toContain("Pathogen Flags:, =cmd|calc");
    expect(text).toContain("1 Filter Applied:");
  });
});

describe("pathogen flag decoration branch coverage", () => {
  const pathogenColumnIndex = (headerBlock: string[]) =>
    headerBlock[0].split(",").length - 1;

  it("carries the genus knownPathogen count through when a pathogens object exists", () => {
    const [headerBlock, rows] = computeMngsReportTableValuesForCSV(
      [
        {
          taxId: 570,
          name: "Klebsiella",
          pathogens: { knownPathogen: 4 },
          filteredSpecies: [],
        },
      ],
      {} as $TSFixMe,
      [],
      WORKFLOW_TABS.SHORT_READ_MNGS,
    );

    const idx = pathogenColumnIndex(headerBlock);
    expect((rows as string[][])[0][0].split(",")[idx]).toBe("4");
  });

  it("falls back to 0 when the pathogens object carries no knownPathogen key", () => {
    const [headerBlock, rows] = computeMngsReportTableValuesForCSV(
      [
        {
          taxId: 570,
          name: "Klebsiella",
          pathogens: { somethingElse: 2 },
          filteredSpecies: [],
        },
      ],
      {} as $TSFixMe,
      [],
      WORKFLOW_TABS.SHORT_READ_MNGS,
    );

    const idx = pathogenColumnIndex(headerBlock);
    expect((rows as string[][])[0][0].split(",")[idx]).toBe("0");
  });

  it("flags species by their pathogenFlags list and treats a missing list as unflagged", () => {
    const [headerBlock, rows] = computeMngsReportTableValuesForCSV(
      [
        {
          taxId: 570,
          name: "Klebsiella",
          filteredSpecies: [
            {
              taxId: 573,
              name: "K. pneumoniae",
              pathogenFlags: ["knownPathogen"],
            },
            { taxId: 571, name: "K. oxytoca", pathogenFlags: ["divergent"] },
            { taxId: 572, name: "K. aerogenes" },
          ],
        },
      ],
      {} as $TSFixMe,
      [],
      WORKFLOW_TABS.SHORT_READ_MNGS,
    );

    const idx = pathogenColumnIndex(headerBlock);
    const cells = (rows as string[][]).map(r => r[0].split(","));
    // rows[0] is the genus; rows[1..3] are the species in order.
    expect(cells[1][idx]).toBe("1");
    expect(cells[2][idx]).toBe("0");
    expect(cells[3][idx]).toBe("0");
  });
});

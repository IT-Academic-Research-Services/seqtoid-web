// Coverage for the report-table halves of app/assets/src/components/utils/csv.ts
// (the pure helpers -- parseCSVBlob / sanitizeCSVRow / createCSVObjectURL /
// createCSVRowForAppliedFilters -- are already covered by jest/utilsCsv.test.ts).
//
// These two exported builders assemble the AMR and mNGS report CSV downloads:
// a header block that also carries a human-readable "N Filters Applied"
// descriptor, followed by one comma-joined string per table row.
import {
  computeAmrReportTableValuesForCSV,
  computeMngsReportTableValuesForCSV,
} from "~/components/utils/csv";
import { WORKFLOW_TABS } from "~/components/utils/workflows";

// Mirrors SECTION_TO_COLUMN_IDS (GENE_INFO, then CONTIGS, then READS) after the
// snakeCase() pass the module applies. Order is load-bearing: it is the column
// order of the downloaded file.
const EXPECTED_AMR_HEADERS = [
  "gene",
  "drug_class",
  "high_level_drug_class",
  "gene_family",
  "mechanism",
  "model",
  "contigs",
  "cutoff",
  "contig_coverage_breadth",
  "contig_percent_id",
  "contig_species",
  "reads",
  "rpm",
  "read_coverage_breadth",
  "read_coverage_depth",
  "dpm",
  "read_species",
];

const amrRow = (overrides: Record<string, unknown> = {}) => ({
  gene: "aadA",
  drugClass: "aminoglycoside",
  highLevelDrugClass: "Aminoglycoside",
  geneFamily: "ANT",
  mechanism: "inactivation",
  model: "protein",
  contigs: 2,
  cutoff: "Perfect",
  contigCoverageBreadth: 100,
  contigPercentId: 99.9,
  contigSpecies: "E. coli",
  reads: 30,
  rpm: 12.5,
  readCoverageBreadth: 88,
  readCoverageDepth: 4,
  dpm: 1.5,
  readSpecies: "E. coli",
  ...overrides,
});

// Splits the "[filterStatement\nheaderRow]" block the builder returns.
const splitAmrHeaderBlock = (block: string[]) => {
  const [filterStatement, headerRow] = block[0].split("\n");
  return { filterStatement, headerRow };
};

describe("computeAmrReportTableValuesForCSV", () => {
  it("emits the AMR column order and a zero-filter descriptor when no filters are active", () => {
    const [headerBlock, rows] = computeAmrReportTableValuesForCSV({
      activeFilters: null,
      displayedRows: { "1": amrRow() as $TSFixMe },
    });

    const { filterStatement, headerRow } = splitAmrHeaderBlock(
      headerBlock as string[],
    );
    expect(headerRow).toBe(EXPECTED_AMR_HEADERS.join());
    // Plural "Filters" is used for 0, singular only for exactly 1.
    expect(filterStatement).toBe("# 0 Filters Applied:");
    expect(rows).toHaveLength(1);
    // NOTE (observed behaviour, not an endorsement): the headers are snakeCase'd
    // ColumnIds but AmrResult rows are keyed in camelCase, so `at()` only
    // resolves the single-word columns. Multi-word columns (drug_class,
    // contig_species, ...) resolve to undefined and sanitizeCSVRow turns those
    // into empty cells. Pinning this so a fix to the key mapping is a visible,
    // deliberate test change rather than a silent one.
    expect(rows[0]).toBe(
      [
        "aadA",
        "",
        "",
        "",
        "inactivation",
        "protein",
        "2",
        "Perfect",
        "",
        "",
        "",
        "30",
        "12.5",
        "",
        "",
        "1.5",
        "",
      ].join(),
    );
  });

  it("pulls values by column id, so unknown/missing fields become empty cells", () => {
    const partial = { gene: "tetA" };
    const [, rows] = computeAmrReportTableValuesForCSV({
      activeFilters: null,
      displayedRows: { "1": partial as $TSFixMe },
    });

    // `at` yields undefined for absent keys and sanitizeCSVRow maps those to "".
    expect(rows[0]).toBe(["tetA", ...Array(16).fill("")].join());
  });

  it("strips leading formula characters from cell values (CSV injection defense)", () => {
    const [, rows] = computeAmrReportTableValuesForCSV({
      activeFilters: null,
      displayedRows: {
        "1": amrRow({ gene: "=SUM(A1:A2)", cutoff: "-Perfect", model: "@x" }),
      },
    });

    const cells = (rows[0] as string).split(",");
    expect(cells[0]).toBe("SUM(A1:A2)");
    expect(cells[5]).toBe("x");
    expect(cells[7]).toBe("Perfect");
  });

  it("renders the singular 'Filter' and a Thresholds line for a single threshold filter", () => {
    const [headerBlock] = computeAmrReportTableValuesForCSV({
      activeFilters: {
        contigs: {
          key: "contigs",
          type: "threshold",
          params: {
            thresholdFilters: [
              {
                metricDisplay: "Number of Contigs",
                operator: ">=",
                value: "1",
              },
            ],
          },
        },
      } as $TSFixMe,
      displayedRows: {},
    });

    const { filterStatement } = splitAmrHeaderBlock(headerBlock as string[]);
    expect(filterStatement).toBe(
      "# 1 Filter Applied:,Thresholds:, Number of Contigs >= 1",
    );
  });

  it("joins multiple thresholds and appends drug classes for a multi-select filter", () => {
    const [headerBlock] = computeAmrReportTableValuesForCSV({
      activeFilters: {
        contigs: {
          key: "contigs",
          type: "threshold",
          params: {
            thresholdFilters: [
              {
                metricDisplay: "Number of Contigs",
                operator: ">=",
                value: "1",
              },
              { metricDisplay: "rPM", operator: ">=", value: "2" },
            ],
          },
        },
        drugClass: {
          key: "drugClass",
          type: "multiple",
          params: { multiSelected: ["aminoglycoside", "tetracycline"] },
        },
      } as $TSFixMe,
      displayedRows: {},
    });

    const { filterStatement } = splitAmrHeaderBlock(headerBlock as string[]);
    // 2 thresholds + 2 drug classes = 4 active filters.
    expect(filterStatement).toContain("# 4 Filters Applied:");
    expect(filterStatement).toContain(
      "Thresholds:, Number of Contigs >= 1,rPM >= 2",
    );
    expect(filterStatement).toContain(
      "Drug Classes:, aminoglycoside,tetracycline",
    );
  });

  it("omits the Thresholds/Drug Classes lines when the filter params are unset", () => {
    const [headerBlock] = computeAmrReportTableValuesForCSV({
      activeFilters: {
        contigs: { key: "contigs", type: "threshold", params: {} },
        drugClass: { key: "drugClass", type: "multiple", params: {} },
      } as $TSFixMe,
      displayedRows: {},
    });

    const { filterStatement } = splitAmrHeaderBlock(headerBlock as string[]);
    expect(filterStatement).toBe("# 0 Filters Applied:");
    expect(filterStatement).not.toContain("Thresholds:");
    expect(filterStatement).not.toContain("Drug Classes:");
  });

  it("ignores filter types it does not know how to describe", () => {
    const [headerBlock] = computeAmrReportTableValuesForCSV({
      activeFilters: {
        cutoff: {
          key: "cutoff",
          type: "single",
          params: { selected: "Nudge" },
        },
      } as $TSFixMe,
      displayedRows: {},
    });

    const { filterStatement } = splitAmrHeaderBlock(headerBlock as string[]);
    // countActiveFilters still counts the single-select, but no descriptor line
    // is emitted for it.
    expect(filterStatement).toBe("# 1 Filter Applied:");
  });

  it("emits one row per displayed row, in object order", () => {
    const [, rows] = computeAmrReportTableValuesForCSV({
      activeFilters: null,
      displayedRows: {
        a: amrRow({ gene: "geneA" }) as $TSFixMe,
        b: amrRow({ gene: "geneB" }) as $TSFixMe,
      },
    });
    expect(rows).toHaveLength(2);
    expect((rows[0] as string).startsWith("geneA,")).toBe(true);
    expect((rows[1] as string).startsWith("geneB,")).toBe(true);
  });
});

const defaultSelectedOptions = () => ({
  annotations: [],
  flags: [],
  background: null,
  categories: { categories: [], subcategories: { Viruses: [] } },
  metricShortReads: "nt_r",
  metricLongReads: "nt_b",
  nameType: "Scientific name",
  readSpecificity: 0,
  taxa: [],
  thresholdsShortReads: [],
  thresholdsLongReads: [],
});

describe("computeMngsReportTableValuesForCSV", () => {
  it("includes background fields for short-read mNGS and the pathogen column last", () => {
    const [headerBlock] = computeMngsReportTableValuesForCSV(
      [],
      defaultSelectedOptions(),
      [],
      WORKFLOW_TABS.SHORT_READ_MNGS,
    );
    const headers = headerBlock[0].split(",");

    expect(headers.slice(0, 8)).toEqual([
      "taxId",
      "taxLevel",
      "genus_tax_id",
      "name",
      "common_name",
      "category",
      "is_phage",
      "species_tax_ids",
    ]);
    expect(headers).toContain("agg_score");
    expect(headers).toContain("max_z_score");
    expect(headers).toContain("nt.z_score");
    expect(headers).toContain("nr.z_score");
    expect(headers[headers.length - 1]).toBe("known_pathogen");
  });

  it("omits background fields and z-score metrics for long-read mNGS", () => {
    const [headerBlock] = computeMngsReportTableValuesForCSV(
      [],
      defaultSelectedOptions(),
      [],
      WORKFLOW_TABS.LONG_READ_MNGS,
    );
    const headers = headerBlock[0].split(",");

    expect(headers).not.toContain("agg_score");
    expect(headers).not.toContain("max_z_score");
    expect(headers).not.toContain("nt.z_score");
    expect(headers).toContain("nt.bpm");
    expect(headers).toContain("nr.base_count");
  });

  it("emits a genus row followed by its filtered species rows", () => {
    const [headerBlock, rows] = computeMngsReportTableValuesForCSV(
      [
        {
          taxId: 570,
          name: "Klebsiella",
          pathogens: { knownPathogen: 3 },
          filteredSpecies: [
            { taxId: 573, name: "Klebsiella pneumoniae", pathogenFlags: [] },
            { taxId: 571, name: "Klebsiella oxytoca" },
          ],
        },
      ],
      defaultSelectedOptions(),
      [],
      WORKFLOW_TABS.SHORT_READ_MNGS,
    );

    const headers = headerBlock[0].split(",");
    const nameIndex = headers.indexOf("name");
    const pathogenIndex = headers.length - 1;

    expect(rows).toHaveLength(3);
    const cells = (rows as string[][]).map(row => row[0].split(","));
    expect(cells[0][nameIndex]).toBe('"Klebsiella"');
    expect(cells[1][nameIndex]).toBe('"Klebsiella pneumoniae"');
    expect(cells[2][nameIndex]).toBe('"Klebsiella oxytoca"');
    // Genus keeps the raw knownPathogen count; species get a 0/1 flag.
    expect(cells[0][pathogenIndex]).toBe("3");
    expect(cells[1][pathogenIndex]).toBe("0");
  });

  it("flags species carrying the knownPathogen code and defaults the genus count to 0", () => {
    const [headerBlock, rows] = computeMngsReportTableValuesForCSV(
      [
        {
          taxId: 570,
          name: "Klebsiella",
          filteredSpecies: [
            {
              taxId: 573,
              name: "Klebsiella pneumoniae",
              pathogenFlags: ["knownPathogen"],
            },
          ],
        },
      ],
      defaultSelectedOptions(),
      [],
      WORKFLOW_TABS.SHORT_READ_MNGS,
    );

    const pathogenIndex = headerBlock[0].split(",").length - 1;
    const genusCells = (rows as string[][])[0][0].split(",");
    const speciesCells = (rows as string[][])[1][0].split(",");
    // No `pathogens` object at all -> falls back to 0.
    expect(genusCells[pathogenIndex]).toBe("0");
    expect(speciesCells[pathogenIndex]).toBe("1");
  });

  it("substitutes a quoted dash for missing values and quotes values containing commas", () => {
    const [headerBlock, rows] = computeMngsReportTableValuesForCSV(
      [{ taxId: 1, name: "Genus, with comma", filteredSpecies: [] }],
      defaultSelectedOptions(),
      [],
      WORKFLOW_TABS.SHORT_READ_MNGS,
    );

    const headers = headerBlock[0].split(",");
    const row = (rows as string[][])[0][0];
    // common_name is absent from the datum -> getOr default "-" -> '"-"'.
    expect(headers).toContain("common_name");
    expect(row).toContain('"-"');
    // The comma-bearing name is wrapped in an extra pair of quotes so it does
    // not spill into a new column.
    expect(row).toContain('""Genus, with comma""');
  });

  it("does not append an applied-filters row when no filters are set", () => {
    const [, rows] = computeMngsReportTableValuesForCSV(
      [{ taxId: 1, name: "Genus", filteredSpecies: [] }],
      defaultSelectedOptions(),
      [],
      WORKFLOW_TABS.SHORT_READ_MNGS,
    );
    expect(rows).toHaveLength(1);
  });

  it("appends an applied-filters row describing the active read specificity", () => {
    const [, rows] = computeMngsReportTableValuesForCSV(
      [{ taxId: 1, name: "Genus", filteredSpecies: [] }],
      { ...defaultSelectedOptions(), readSpecificity: 1 },
      [],
      WORKFLOW_TABS.SHORT_READ_MNGS,
    );

    expect(rows).toHaveLength(2);
    const filterRow = (rows as string[][])[1][0];
    expect(filterRow).toContain("1 Filter Applied:");
    expect(filterRow).toContain('Read Specificity:, "Specific Only"');
  });

  it("names the selected background and counts taxon filters in the applied-filters row", () => {
    const [, rows] = computeMngsReportTableValuesForCSV(
      [{ taxId: 1, name: "Genus", filteredSpecies: [] }],
      {
        ...defaultSelectedOptions(),
        background: 7,
        taxa: [{ id: 573, name: "Klebsiella pneumoniae" }],
      },
      [{ id: 7, name: "Human CSF HC" }],
      WORKFLOW_TABS.SHORT_READ_MNGS,
    );

    const filterRow = (rows as string[][])[1][0];
    expect(filterRow).toContain('Background:, "Human CSF HC"');
    expect(filterRow).toContain("Taxon Name:, Klebsiella pneumoniae");
    expect(filterRow).toContain("1 Filter Applied:");
  });
});

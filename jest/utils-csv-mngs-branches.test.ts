// Remaining branch coverage for computeMngsReportTableValuesForCSV in
// app/assets/src/components/utils/csv.ts.
//
// The row serializer runs the same two guards over genus rows and species rows:
//   * `val === "null" ? '"-"' : val` -- an explicitly-null cell (as opposed to an
//     absent one, which lodash getOr already defaults to "-") JSON-stringifies to
//     the literal string "null" and must be rewritten to a quoted dash.
//   * `val.includes(",") ? '"' + val + '"' : val` -- a value containing a comma has
//     to be double-quoted so it does not spill into the next CSV column.
// The species copies of both guards were untaken, as was the false arm of
// `has("filteredSpecies", datum)`.
import { computeMngsReportTableValuesForCSV } from "~/components/utils/csv";
import { WORKFLOW_TABS } from "~/components/utils/workflows";

const selectedOptions = () => ({
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

/* eslint-disable @typescript-eslint/no-explicit-any */
const compute = (reportData: any[]) =>
  computeMngsReportTableValuesForCSV(
    reportData,
    selectedOptions(),
    [],
    WORKFLOW_TABS.SHORT_READ_MNGS,
  );
/* eslint-enable @typescript-eslint/no-explicit-any */

const cellsOf = (headerBlock: string[], rows: string[][], index: number) => ({
  headers: headerBlock[0].split(","),
  cells: rows[index][0].split(","),
});

describe("computeMngsReportTableValuesForCSV null cells", () => {
  it("rewrites an explicitly-null genus cell to a quoted dash", () => {
    const [headerBlock, rows] = compute([
      { taxId: 1, name: "Genus", common_name: null, filteredSpecies: [] },
    ]);
    const { headers, cells } = cellsOf(headerBlock, rows as string[][], 0);

    // getOr only defaults on `undefined`, so an explicit null reaches
    // JSON.stringify and comes back as the string "null".
    expect(cells[headers.indexOf("common_name")]).toBe('"-"');
    expect(cells[headers.indexOf("name")]).toBe('"Genus"');
  });

  it("rewrites an explicitly-null species cell to a quoted dash", () => {
    const [headerBlock, rows] = compute([
      {
        taxId: 1,
        name: "Genus",
        filteredSpecies: [{ taxId: 2, name: "Species", common_name: null }],
      },
    ]);
    const { headers, cells } = cellsOf(headerBlock, rows as string[][], 1);

    expect(cells[headers.indexOf("common_name")]).toBe('"-"');
    expect(cells[headers.indexOf("name")]).toBe('"Species"');
  });
});

describe("computeMngsReportTableValuesForCSV comma-bearing species cells", () => {
  it("double-quotes a species value containing a comma", () => {
    const [headerBlock, rows] = compute([
      {
        taxId: 1,
        name: "Genus",
        filteredSpecies: [{ taxId: 2, name: "Escherichia coli, strain K-12" }],
      },
    ]);
    const { headers, cells } = cellsOf(headerBlock, rows as string[][], 1);
    const nameIndex = headers.indexOf("name");

    // The comma splits the raw row into two cells, both wrapped by the extra
    // quote pair the guard adds.
    expect(cells[nameIndex]).toBe('""Escherichia coli');
    expect(rows[1][0]).toContain('""Escherichia coli, strain K-12""');
  });

  it("leaves a comma-free species value unquoted beyond its JSON quotes", () => {
    const [headerBlock, rows] = compute([
      {
        taxId: 1,
        name: "Genus",
        filteredSpecies: [{ taxId: 2, name: "Ecoli" }],
      },
    ]);
    const { headers, cells } = cellsOf(headerBlock, rows as string[][], 1);

    expect(cells[headers.indexOf("name")]).toBe('"Ecoli"');
  });
});

describe("computeMngsReportTableValuesForCSV species emission guard", () => {
  it("emits species rows when filteredSpecies is an own property", () => {
    const [, rows] = compute([
      {
        taxId: 1,
        name: "Genus",
        filteredSpecies: [{ taxId: 2, name: "Species" }],
      },
    ]);

    expect(rows).toHaveLength(2);
  });

  it("emits only the genus row when filteredSpecies is inherited, not own", () => {
    // `has` is lodash's own-property check, so a datum that only inherits
    // filteredSpecies (readable enough for the pathogen-flag pass that runs
    // first) takes the false arm and contributes no species rows.
    const datum = Object.create({ filteredSpecies: [{ taxId: 2, name: "S" }] });
    datum.taxId = 1;
    datum.name = "Genus";

    const [, rows] = compute([datum]);

    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toContain('"Genus"');
  });
});

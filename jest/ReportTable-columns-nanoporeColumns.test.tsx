// Coverage for
// app/assets/src/components/views/SampleView/components/MngsReport/components/
//   ReportTable/components/columns/nanoporeColumns.tsx
//
// getNanoporeColumns builds the long-read (ONT) value columns: bPM, bases,
// reads, contigs and contig bases. The file has no conditionals of its own --
// every uncovered line is a closure (cellDataGetter / sortFunction) that only
// executes when the virtualized table calls it -- so each closure is invoked
// directly against fixture rows, in both sort directions and for both dbTypes.
//
// ReportTable.tsx (null-value sentinels) and the cell-value renderer pull in
// .scss modules that Jest resolves via the `~` alias instead of the style mock,
// so both are stubbed; stubbing the renderer also lets the test assert which
// dbType/decimal-places each column was built with.
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/ReportTable",
  () => ({
    NUMBER_NULL_VALUES: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/cellValueRenderer",
  () => ({
    getCellValueRenderer: (dbType: string, decimalPlaces?: number) => ({
      kind: "cellValue",
      dbType,
      decimalPlaces,
    }),
  }),
);

import { getNanoporeColumns } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/nanoporeColumns";

const genus = {
  name: "GenusA",
  taxId: 1001,
  nt: { bpm: 10, base_count: 100, count: 5, contigs: 2, contig_b: 50 },
  nr: { bpm: 1, base_count: 10, count: 1, contigs: 1, contig_b: 5 },
};
const species = {
  name: "SpeciesA1",
  taxId: 11,
  genus,
  nt: { bpm: 20, base_count: 200, count: 9, contigs: 4, contig_b: 90 },
  nr: { bpm: 2, base_count: 20, count: 2, contigs: 2, contig_b: 9 },
};

const byKey = (columns: $TSFixMe[]) =>
  columns.reduce((acc: $TSFixMe, col: $TSFixMe) => {
    acc[col.dataKey] = col;
    return acc;
  }, {});

describe("getNanoporeColumns -- shape", () => {
  it("returns the five long-read value columns in report order", () => {
    const columns = getNanoporeColumns("nt");
    expect(columns.map((c: $TSFixMe) => c.dataKey)).toEqual([
      "bpm",
      "b",
      "r",
      "contigs",
      "contig_b",
    ]);
    expect(columns.map((c: $TSFixMe) => c.label)).toEqual([
      "bPM",
      "b",
      "r",
      "contig",
      "contig b",
    ]);
  });

  it("gives every column the shared nanopore width and column metadata", () => {
    const columns = getNanoporeColumns("nt");
    columns.forEach((col: $TSFixMe) => {
      expect(col.width).toBe(80);
      expect(col.columnData).toBeDefined();
    });
  });

  it("renders bPM to one decimal place and the rest as whole values", () => {
    const columns = byKey(getNanoporeColumns("nr"));
    expect(columns.bpm.cellRenderer).toEqual({
      kind: "cellValue",
      dbType: "nr",
      decimalPlaces: 1,
    });
    expect(columns.b.cellRenderer).toEqual({
      kind: "cellValue",
      dbType: "nr",
      decimalPlaces: undefined,
    });
    expect(columns.contig_b.cellRenderer).toEqual({
      kind: "cellValue",
      dbType: "nr",
      decimalPlaces: undefined,
    });
  });
});

describe("getNanoporeColumns -- cellDataGetter closures", () => {
  const columns = byKey(getNanoporeColumns("nt"));

  it("reads each field as an [nt, nr] pair", () => {
    expect(columns.bpm.cellDataGetter({ rowData: species })).toEqual([20, 2]);
    expect(columns.b.cellDataGetter({ rowData: species })).toEqual([200, 20]);
    expect(columns.r.cellDataGetter({ rowData: species })).toEqual([9, 2]);
    expect(columns.contigs.cellDataGetter({ rowData: species })).toEqual([
      4, 2,
    ]);
    expect(columns.contig_b.cellDataGetter({ rowData: species })).toEqual([
      90, 9,
    ]);
  });

  it("falls back to 0 when a count type or field is missing", () => {
    expect(columns.bpm.cellDataGetter({ rowData: { nt: {} } })).toEqual([0, 0]);
    expect(columns.contig_b.cellDataGetter({ rowData: {} })).toEqual([0, 0]);
  });

  it("does not depend on the dbType -- the getter always returns nt then nr", () => {
    const nrColumns = byKey(getNanoporeColumns("nr"));
    expect(nrColumns.r.cellDataGetter({ rowData: species })).toEqual([9, 2]);
  });
});

describe("getNanoporeColumns -- sortFunction closures", () => {
  const data = [species, genus];

  it("keeps a genus above its species when sorting descending", () => {
    const columns = byKey(getNanoporeColumns("nt"));
    ["bpm", "b", "r", "contigs", "contig_b"].forEach(key => {
      const sorted = columns[key].sortFunction({
        data,
        sortDirection: "desc",
      });
      expect(sorted.map((r: $TSFixMe) => r.name)).toEqual([
        "GenusA",
        "SpeciesA1",
      ]);
    });
  });

  it("keeps a genus above its species when sorting ascending", () => {
    const columns = byKey(getNanoporeColumns("nt"));
    ["bpm", "b", "r", "contigs", "contig_b"].forEach(key => {
      const sorted = columns[key].sortFunction({
        data,
        sortDirection: "asc",
      });
      expect(sorted.map((r: $TSFixMe) => r.name)).toEqual([
        "GenusA",
        "SpeciesA1",
      ]);
    });
  });

  it("sorts sibling genera by the requested dbType", () => {
    const rows = [
      { name: "Low", taxId: 1, nt: { bpm: 1 }, nr: { bpm: 100 } },
      { name: "High", taxId: 2, nt: { bpm: 100 }, nr: { bpm: 1 } },
    ];
    const ntColumns = byKey(getNanoporeColumns("nt"));
    const nrColumns = byKey(getNanoporeColumns("nr"));

    expect(
      ntColumns.bpm
        .sortFunction({ data: rows, sortDirection: "desc" })
        .map((r: $TSFixMe) => r.name),
    ).toEqual(["High", "Low"]);
    expect(
      nrColumns.bpm
        .sortFunction({ data: rows, sortDirection: "desc" })
        .map((r: $TSFixMe) => r.name),
    ).toEqual(["Low", "High"]);
  });

  it("treats a row missing the sorted field as the null value", () => {
    const rows = [
      { name: "Missing", taxId: 1, nt: {} },
      { name: "Present", taxId: 2, nt: { base_count: 5 } },
    ];
    const columns = byKey(getNanoporeColumns("nt"));
    expect(
      columns.b
        .sortFunction({ data: rows, sortDirection: "desc" })
        .map((r: $TSFixMe) => r.name),
    ).toEqual(["Present", "Missing"]);
  });
});

// Coverage for
// app/assets/src/components/views/SampleView/components/MngsReport/components/
//   ReportTable/components/columns/illuminaColumns.tsx
//
// getIlluminaColumns builds the short-read (Illumina) half of the taxon report
// table's column set. The only real branching is `assemblyEnabled &&` on the
// two contig columns -- driven by isPipelineFeatureAvailable(ASSEMBLY_FEATURE,
// pipelineVersion) -- so both a pre-assembly and a post-assembly pipeline
// version are exercised. Everything else in the file is a closure
// (cellDataGetter / sortFunction) that only runs when the table calls it, so
// each one is invoked directly against fixture rows.
//
// ReportTable.tsx (the source of the null-value sentinels) and the three cell
// renderers drag in .scss modules that Jest resolves through the `~` alias
// rather than the style mock, so they are stubbed here. Stubbing the renderers
// additionally lets the test assert which renderer each column was given and
// with what arguments.
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/ReportTable",
  () => ({
    NUMBER_NULL_VALUES: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    Z_SCORE_NULL_VALUE: -100,
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/aggregateScoreRenderer",
  () => ({
    getAggregateScoreRenderer: (displayNoBackground: boolean) => ({
      kind: "aggregateScore",
      displayNoBackground,
    }),
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

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/renderers/zScoreRenderer",
  () => ({
    getZScoreRenderer: (dbType: string, displayNoBackground: boolean) => ({
      kind: "zScore",
      dbType,
      displayNoBackground,
    }),
  }),
);

import { getIlluminaColumns } from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/illuminaColumns";

// Rows shaped like the report table's Taxon data: a genus row (no `.genus`) and
// a species row that points back at its parent genus.
const genus = {
  name: "GenusA",
  taxId: 1001,
  nt: { z_score: 5, rpm: 20, count: 200, contigs: 2, contig_r: 8 },
  nr: { z_score: 1, rpm: 2, count: 20, contigs: 1, contig_r: 3 },
  agg_score: 900,
};
const species = {
  name: "SpeciesA1",
  taxId: 11,
  genus,
  nt: { z_score: 9, rpm: 30, count: 300, contigs: 4, contig_r: 9 },
  nr: { z_score: 3, rpm: 4, count: 40, contigs: 2, contig_r: 5 },
  agg_score: 100,
};

const byKey = (columns: $TSFixMe[]) =>
  columns.filter(Boolean).reduce((acc: $TSFixMe, col: $TSFixMe) => {
    acc[col.dataKey] = col;
    return acc;
  }, {});

describe("getIlluminaColumns -- assembly feature gating", () => {
  it("includes the contig columns for a pipeline at/after the assembly version", () => {
    const columns = getIlluminaColumns("nt", false, "3.1.0");
    const keys = columns.filter(Boolean).map((c: $TSFixMe) => c.dataKey);

    expect(keys).toEqual([
      "agg_score",
      "z_score",
      "rpm",
      "r",
      "contigs",
      "contig_r",
    ]);
  });

  it("drops the contig columns for a pipeline before the assembly version", () => {
    const columns = getIlluminaColumns("nt", false, "2.9.0");
    const keys = columns.filter(Boolean).map((c: $TSFixMe) => c.dataKey);

    expect(keys).toEqual(["agg_score", "z_score", "rpm", "r"]);
    // The falsy slots are still present in the raw array -- the table filters.
    expect(columns).toHaveLength(6);
    expect(columns[4]).toBe(false);
    expect(columns[5]).toBe(false);
  });

  it("drops the contig columns when no pipeline version is known", () => {
    const columns = getIlluminaColumns("nt", false, undefined);
    expect(columns.filter(Boolean).map((c: $TSFixMe) => c.dataKey)).toEqual([
      "agg_score",
      "z_score",
      "rpm",
      "r",
    ]);
  });
});

describe("getIlluminaColumns -- displayNoBackground gating", () => {
  it("leaves score and z-score sortable when a background is selected", () => {
    const columns = byKey(getIlluminaColumns("nt", false, "3.1.0"));
    expect(columns.agg_score.disableSort).toBe(false);
    expect(columns.z_score.disableSort).toBe(false);
  });

  it("disables score and z-score sorting when there is no background", () => {
    const columns = byKey(getIlluminaColumns("nt", true, "3.1.0"));
    expect(columns.agg_score.disableSort).toBe(true);
    expect(columns.z_score.disableSort).toBe(true);
  });
});

describe("getIlluminaColumns -- cellDataGetter closures", () => {
  const columns = byKey(getIlluminaColumns("nt", false, "3.1.0"));

  it("pulls [nt, nr] z-scores, defaulting missing values to the z-score null", () => {
    expect(columns.z_score.cellDataGetter({ rowData: species })).toEqual([
      9, 3,
    ]);
    expect(
      columns.z_score.cellDataGetter({ rowData: { nt: {}, nr: {} } }),
    ).toEqual([-100, -100]);
  });

  it("pulls [nt, nr] rpm / reads / contigs / contig reads", () => {
    expect(columns.rpm.cellDataGetter({ rowData: species })).toEqual([30, 4]);
    expect(columns.r.cellDataGetter({ rowData: species })).toEqual([300, 40]);
    expect(columns.contigs.cellDataGetter({ rowData: species })).toEqual([
      4, 2,
    ]);
    expect(columns.contig_r.cellDataGetter({ rowData: species })).toEqual([
      9, 5,
    ]);
  });

  it("defaults counts to 0 when the count type is absent", () => {
    expect(columns.r.cellDataGetter({ rowData: { name: "bare" } })).toEqual([
      0, 0,
    ]);
  });

  it("has no cellDataGetter on the aggregate score column", () => {
    expect(columns.agg_score.cellDataGetter).toBeUndefined();
  });
});

describe("getIlluminaColumns -- sortFunction closures", () => {
  const data = [species, genus];

  it("sorts the aggregate score column descending with the genus above its species", () => {
    const columns = byKey(getIlluminaColumns("nt", false, "3.1.0"));
    const sorted = columns.agg_score.sortFunction({
      data,
      sortDirection: "desc",
    });
    expect(sorted.map((r: $TSFixMe) => r.name)).toEqual([
      "GenusA",
      "SpeciesA1",
    ]);
  });

  it("keeps the genus above its species when sorting ascending too", () => {
    const columns = byKey(getIlluminaColumns("nt", false, "3.1.0"));
    const sorted = columns.rpm.sortFunction({ data, sortDirection: "asc" });
    expect(sorted.map((r: $TSFixMe) => r.name)).toEqual([
      "GenusA",
      "SpeciesA1",
    ]);
  });

  it("honors the dbType when sorting the nt/nr columns", () => {
    const ntColumns = byKey(getIlluminaColumns("nt", false, "3.1.0"));
    const nrColumns = byKey(getIlluminaColumns("nr", false, "3.1.0"));
    const twoGenera = [
      { name: "Low", taxId: 1, nt: { count: 1 }, nr: { count: 100 } },
      { name: "High", taxId: 2, nt: { count: 100 }, nr: { count: 1 } },
    ];

    expect(
      ntColumns.r
        .sortFunction({ data: twoGenera, sortDirection: "desc" })
        .map((r: $TSFixMe) => r.name),
    ).toEqual(["High", "Low"]);
    expect(
      nrColumns.r
        .sortFunction({ data: twoGenera, sortDirection: "desc" })
        .map((r: $TSFixMe) => r.name),
    ).toEqual(["Low", "High"]);
  });

  it("sorts the contig columns", () => {
    const columns = byKey(getIlluminaColumns("nt", false, "3.1.0"));
    const rows = [
      { name: "Few", taxId: 1, nt: { contigs: 1, contig_r: 1 } },
      { name: "Many", taxId: 2, nt: { contigs: 9, contig_r: 9 } },
    ];
    expect(
      columns.contigs
        .sortFunction({ data: rows, sortDirection: "desc" })
        .map((r: $TSFixMe) => r.name),
    ).toEqual(["Many", "Few"]);
    expect(
      columns.contig_r
        .sortFunction({ data: rows, sortDirection: "asc" })
        .map((r: $TSFixMe) => r.name),
    ).toEqual(["Few", "Many"]);
    expect(
      columns.z_score
        .sortFunction({ data: [genus, species], sortDirection: "desc" })
        .map((r: $TSFixMe) => r.name),
    ).toEqual(["GenusA", "SpeciesA1"]);
  });
});

describe("getIlluminaColumns -- column metadata", () => {
  it("attaches labels, widths and cell renderers", () => {
    const columns = byKey(getIlluminaColumns("nt", false, "3.1.0"));
    expect(columns.agg_score.label).toBe("Score");
    expect(columns.agg_score.width).toBe(130);
    expect(columns.rpm.label).toBe("rPM");
    expect(columns.r.width).toBe(75);
    expect(columns.contig_r.label).toBe("contig r");
    expect(columns.z_score.columnData).toBeDefined();
  });

  it("wires each column to its renderer, forwarding dbType and flags", () => {
    const columns = byKey(getIlluminaColumns("nr", true, "3.1.0"));

    expect(columns.agg_score.cellRenderer).toEqual({
      kind: "aggregateScore",
      displayNoBackground: true,
    });
    expect(columns.z_score.cellRenderer).toEqual({
      kind: "zScore",
      dbType: "nr",
      displayNoBackground: true,
    });
    // rPM is the only value column rendered to one decimal place.
    expect(columns.rpm.cellRenderer).toEqual({
      kind: "cellValue",
      dbType: "nr",
      decimalPlaces: 1,
    });
    expect(columns.r.cellRenderer).toEqual({
      kind: "cellValue",
      dbType: "nr",
      decimalPlaces: undefined,
    });
    expect(columns.contigs.cellRenderer).toEqual({
      kind: "cellValue",
      dbType: "nr",
      decimalPlaces: undefined,
    });
  });
});

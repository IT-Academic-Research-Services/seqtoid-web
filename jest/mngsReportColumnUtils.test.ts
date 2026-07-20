// Frontend coverage: MngsReport ReportTable columns/utils.ts holds the pure data
// helpers for the taxon report table: pulling per-count-type values out of a row
// and the nested genus/species sort that keeps species grouped under their genus.
// Cover the count-type extraction (default + custom types, missing-field
// fallback) and the sort's genus/species + asc/desc branches.
import {
  getCountTypeValuesFromDataRow,
  nestedNtNrSortFunction,
  nestedSortFunction,
} from "~/components/views/SampleView/components/MngsReport/components/ReportTable/components/columns/utils";

describe("getCountTypeValuesFromDataRow", () => {
  const rowData = {
    nt: { reads: 10, rpm: 100 },
    nr: { reads: 5, rpm: 50 },
  } as any;

  it("returns nt then nr values by default", () => {
    expect(
      getCountTypeValuesFromDataRow({
        rowData,
        field: "reads",
        defaultValue: 0,
      }),
    ).toEqual([10, 5]);
  });

  it("honors a custom countTypes order", () => {
    expect(
      getCountTypeValuesFromDataRow({
        rowData,
        field: "rpm",
        defaultValue: 0,
        countTypes: ["nr", "nt"],
      }),
    ).toEqual([50, 100]);
  });

  it("falls back to defaultValue for a missing field", () => {
    expect(
      getCountTypeValuesFromDataRow({
        rowData,
        field: "contigs",
        defaultValue: "-",
      }),
    ).toEqual(["-", "-"]);
  });
});

// Two genera, each with one child species. Genus rows have no `.genus`; species
// rows carry a `.genus` pointer to their parent (mirroring the real report data).
const buildData = () => {
  const genusA = { name: "GenusA", taxId: 1001, nt: { count: 2 } };
  const genusB = { name: "GenusB", taxId: 1002, nt: { count: 3 } };
  return [
    genusA,
    { name: "SpeciesA1", taxId: 11, genus: genusA, nt: { count: 1 } },
    genusB,
    { name: "SpeciesB1", taxId: 21, genus: genusB, nt: { count: 2 } },
  ];
};

const names = (rows: any[]) => rows.map(r => r.name);

describe("nestedSortFunction", () => {
  it("sorts descending with each genus above its species", () => {
    const sorted = nestedSortFunction({
      data: buildData(),
      path: ["nt", "count"],
      sortDirection: "desc",
      nullValue: -1,
      limits: [-1, 999],
    });
    // GenusB (count 3) group first, then GenusA (count 2) group; genus above species.
    expect(names(sorted)).toEqual([
      "GenusB",
      "SpeciesB1",
      "GenusA",
      "SpeciesA1",
    ]);
  });

  it("sorts ascending with each genus above its species", () => {
    const sorted = nestedSortFunction({
      data: buildData(),
      path: ["nt", "count"],
      sortDirection: "asc",
      nullValue: -1,
      limits: [-1, 999],
    });
    // GenusA (count 2) group first, then GenusB (count 3) group; genus above species.
    expect(names(sorted)).toEqual([
      "GenusA",
      "SpeciesA1",
      "GenusB",
      "SpeciesB1",
    ]);
  });
});

describe("nestedNtNrSortFunction", () => {
  it("prefixes the path with dbType and delegates to nestedSortFunction", () => {
    const sorted = nestedNtNrSortFunction({
      dbType: "nt",
      data: buildData(),
      path: ["count"],
      sortDirection: "desc",
      nullValue: -1,
      limits: [-1, 999],
    });
    expect(names(sorted)).toEqual([
      "GenusB",
      "SpeciesB1",
      "GenusA",
      "SpeciesA1",
    ]);
  });
});

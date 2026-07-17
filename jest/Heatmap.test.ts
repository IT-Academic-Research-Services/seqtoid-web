// CZID-462 (#586) coverage: app/assets/src/components/visualizations/heatmap/Heatmap.ts
//
// Heatmap is a d3 visualization class rather than a React component, so it is
// exercised directly: construct it against a real jsdom container, drive the
// data pipeline (parseData -> filterData -> processMetadata -> cluster), and
// assert on the derived state it produces. Assertions target outcomes -- cell
// records, scale limits, clustering/sort order, CSV export -- rather than SVG
// internals, which are an implementation detail of d3.
//
// Two jsdom gaps are patched below. Neither hides product behaviour:
//   1. heatmap.scss resolves to an empty object via the styleMock
//      moduleNameMapper entry, so `cs.primaryLight` is undefined and the
//      SVG colour filter built in setupContainers throws while parsing the hex
//      string. Webpack supplies the real value in the app.
//   2. jsdom does not implement CSS.escape, which renderColumnMetadataCells
//      calls. Every supported browser implements it.

jest.mock(
  "../app/assets/src/components/visualizations/heatmap/heatmap.scss",
  () => ({ primaryLight: "#3867fa" }),
);

import Heatmap from "../app/assets/src/components/visualizations/heatmap/Heatmap";

if (typeof (global as $TSFixMe).CSS === "undefined") {
  (global as $TSFixMe).CSS = {
    escape: (value: string) =>
      String(value).replace(/([^a-zA-Z0-9_-])/g, "\\$1"),
  };
}

const buildHeatmap = (data: $TSFixMe, options: $TSFixMe = {}) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return new Heatmap(container as HTMLElement, data, options);
};

// Two rows / two columns. Row and column labels are deliberately NOT in
// alphabetical order so that sorting has something to actually do.
const baseData = () => ({
  rowLabels: [
    { label: "beta", genusName: "genusB", sortKey: 2 },
    { label: "alpha", genusName: "genusA", sortKey: 1 },
  ],
  columnLabels: [
    { label: "cB", id: 1, metadata: { sample_type: "blood" }, pinned: false },
    { label: "cA", id: 2, metadata: { sample_type: "stool" }, pinned: false },
  ],
  values: [
    [1, 2],
    [3, 4],
  ],
});

// Runs only the data-derivation part of the pipeline, skipping all rendering.
const parseAndFilter = (heatmap: $TSFixMe) => {
  heatmap.parseData();
  heatmap.filterData();
};

const posByLabel = (labels: $TSFixMe) =>
  labels.reduce((acc: $TSFixMe, label: $TSFixMe) => {
    acc[label.label] = label.pos;
    return acc;
  }, {});

describe("visualizations/heatmap/Heatmap", () => {
  describe("constructor", () => {
    it("applies default options", () => {
      const heatmap = buildHeatmap(baseData(), {});
      expect(heatmap.options.numberOfLevels).toBe(10);
      expect(heatmap.options.scale).toBe("linear");
      expect(heatmap.options.clustering).toBe(true);
      expect(heatmap.options.nullValue).toBe(0);
      expect(heatmap.options.colorNoValue).toBe("#eaeaea");
    });

    it("lets caller options override the defaults", () => {
      const heatmap = buildHeatmap(baseData(), {
        clustering: false,
        minCellWidth: 99,
      });
      expect(heatmap.options.clustering).toBe(false);
      expect(heatmap.options.minCellWidth).toBe(99);
      // Untouched defaults survive the merge.
      expect(heatmap.options.minCellHeight).toBe(26);
    });

    it("derives a default colour ramp of numberOfLevels entries", () => {
      const heatmap = buildHeatmap(baseData(), { numberOfLevels: 4 });
      expect(heatmap.options.colors).toHaveLength(4);
      heatmap.options.colors.forEach((color: string) =>
        expect(color).toMatch(/^rgb/),
      );
    });

    it("keeps a caller-supplied colour ramp instead of generating one", () => {
      const colors = ["#000000", "#ffffff"];
      const heatmap = buildHeatmap(baseData(), { colors });
      expect(heatmap.options.colors).toBe(colors);
    });
  });

  describe("getScaleType", () => {
    it("returns a linear scale by default", () => {
      const heatmap = buildHeatmap(baseData(), {});
      const scale = heatmap.getScaleType()().domain([0, 10]).range([0, 1]);
      expect(scale(5)).toBeCloseTo(0.5);
    });

    it("returns a symlog scale when scale is symlog", () => {
      const heatmap = buildHeatmap(baseData(), { scale: "symlog" });
      const scale = heatmap.getScaleType()().domain([0, 10]).range([0, 1]);
      // A symlog scale is non-linear, so the midpoint of the domain must not
      // land on the midpoint of the range the way a linear scale would.
      expect(scale(5)).not.toBeCloseTo(0.5);
    });
  });

  describe("range", () => {
    it("returns a zero-based index array", () => {
      const heatmap = buildHeatmap(baseData(), {});
      expect(heatmap.range(4)).toEqual([0, 1, 2, 3]);
    });

    it("returns an empty array for zero", () => {
      const heatmap = buildHeatmap(baseData(), {});
      expect(heatmap.range(0)).toEqual([]);
    });
  });

  describe("applyScale", () => {
    const double = (value: number) => value * 2;

    it("clamps the value to the max before scaling", () => {
      const heatmap = buildHeatmap(baseData(), {});
      expect(heatmap.applyScale(double, 100, 0, 10)).toBe(20);
    });

    it("clamps the value to the min before scaling", () => {
      const heatmap = buildHeatmap(baseData(), {});
      expect(heatmap.applyScale(double, -5, 0, 10)).toBe(0);
    });

    it("rounds the scaled result", () => {
      const heatmap = buildHeatmap(baseData(), {});
      expect(heatmap.applyScale(double, 1.3, 0, 10)).toBe(3);
    });
  });

  describe("parseData", () => {
    it("assigns a position to every row and column label", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      expect(heatmap.rowLabels.map((r: $TSFixMe) => r.pos)).toEqual([0, 1]);
      expect(heatmap.columnLabels.map((c: $TSFixMe) => c.pos)).toEqual([0, 1]);
      expect(heatmap.rowLabels.every((r: $TSFixMe) => r.shaded === false)).toBe(
        true,
      );
    });

    it("builds one cell per row/column pair carrying its value and indices", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      expect(heatmap.cells).toHaveLength(4);
      expect(heatmap.cells[0]).toEqual({
        id: "0,0",
        rowIndex: 0,
        columnIndex: 0,
        value: 1,
        meetsUserFilters: true,
      });
      expect(heatmap.cells[3]).toMatchObject({ id: "1,1", value: 4 });
    });

    it("widens limits to include nullValue", () => {
      const heatmap = buildHeatmap(
        {
          ...baseData(),
          values: [
            [5, 6],
            [7, 8],
          ],
        },
        {},
      );
      parseAndFilter(heatmap);
      // Data min is 5, but nullValue (0) is rendered too and must fit.
      expect(heatmap.limits).toEqual({ min: 0, max: 8 });
    });

    it("defaults scaleLimits to the data limits", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      expect(heatmap.scaleLimits).toEqual(heatmap.limits);
    });

    it("honours explicit scaleMin/scaleMax over the data limits", () => {
      const heatmap = buildHeatmap(baseData(), { scaleMin: 2, scaleMax: 100 });
      parseAndFilter(heatmap);
      expect(heatmap.scaleLimits).toEqual({ min: 2, max: 100 });
    });

    it("treats a scaleMin/scaleMax of 0 as a real bound, not as unset", () => {
      const heatmap = buildHeatmap(
        {
          ...baseData(),
          values: [
            [5, 6],
            [7, 8],
          ],
        },
        // nullValue keeps the data limits away from 0 on BOTH ends, so a 0
        // bound that wrongly fell through to the limits would be visible.
        { scaleMin: 0, scaleMax: 0, nullValue: 5 },
      );
      parseAndFilter(heatmap);
      expect(heatmap.limits).toEqual({ min: 5, max: 8 });
      // Guards the `|| x === 0` arm: a falsy-but-valid 0 must not fall back
      // to the data limits.
      expect(heatmap.scaleLimits).toEqual({ min: 0, max: 0 });
    });

    it("marks every cell as meeting filters when no taxonFilterState is given", () => {
      // The deprecated AMR heatmap constructs this class without filter info.
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      expect(
        heatmap.cells.every((cell: $TSFixMe) => cell.meetsUserFilters),
      ).toBe(true);
    });

    it("resolves meetsUserFilters from taxonFilterState when present", () => {
      const data: $TSFixMe = baseData();
      data.rowLabels[0].filterStateRow = "R0";
      data.rowLabels[1].filterStateRow = "R1";
      data.columnLabels[0].filterStateColumn = "C0";
      data.columnLabels[1].filterStateColumn = "C1";
      data.taxonFilterState = {
        R0: { C0: true, C1: false },
        R1: { C0: false, C1: true },
      };
      const heatmap = buildHeatmap(data, {});
      parseAndFilter(heatmap);
      expect(
        heatmap.cells.map((cell: $TSFixMe) => [cell.id, cell.meetsUserFilters]),
      ).toEqual([
        ["0,0", true],
        ["0,1", false],
        ["1,0", false],
        ["1,1", true],
      ]);
    });

    it("handles a single row and single column", () => {
      const heatmap = buildHeatmap(
        {
          rowLabels: [{ label: "only", genusName: "g", sortKey: 1 }],
          columnLabels: [{ label: "c", id: 1, metadata: {}, pinned: false }],
          values: [[7]],
        },
        {},
      );
      parseAndFilter(heatmap);
      expect(heatmap.cells).toHaveLength(1);
      expect(heatmap.limits).toEqual({ min: 0, max: 7 });
    });

    it("handles empty data without throwing", () => {
      const heatmap = buildHeatmap(
        { rowLabels: [], columnLabels: [], values: [] },
        {},
      );
      expect(() => parseAndFilter(heatmap)).not.toThrow();
      expect(heatmap.cells).toEqual([]);
      expect(heatmap.filteredCells).toEqual([]);
      expect(heatmap.filteredRowLabels).toEqual([]);
    });
  });

  describe("filterData", () => {
    it("drops null cells but keeps zero-valued cells", () => {
      const data: $TSFixMe = baseData();
      data.values = [
        [0, null],
        [3, 4],
      ];
      const heatmap = buildHeatmap(data, {});
      parseAndFilter(heatmap);
      // 0 is a real measurement and must survive; null means "no data".
      expect(heatmap.filteredCells.map((c: $TSFixMe) => c.id)).toEqual([
        "0,0",
        "1,0",
        "1,1",
      ]);
    });

    it("drops cells belonging to hidden rows", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      heatmap.rowLabels[0].hidden = true;
      heatmap.filterData();
      expect(heatmap.filteredCells.map((c: $TSFixMe) => c.id)).toEqual([
        "1,0",
        "1,1",
      ]);
      expect(heatmap.filteredRowLabels.map((r: $TSFixMe) => r.label)).toEqual([
        "alpha",
      ]);
    });

    it("orders filtered row labels by sortKey so genus separators line up", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      // "alpha" has sortKey 1, "beta" has sortKey 2, so alpha comes first even
      // though beta is first in the input.
      expect(heatmap.filteredRowLabels.map((r: $TSFixMe) => r.label)).toEqual([
        "alpha",
        "beta",
      ]);
    });
  });

  describe("getRows / getColumns", () => {
    it("returns rows scaled into 0..1 against the data limits", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      // limits are 0..4, so values 1,2,3,4 map to .25,.5,.75,1.
      // Array.from drops the `idx` property getRows pins onto each row; it is
      // asserted separately below.
      expect(heatmap.getRows().map((r: $TSFixMe) => Array.from(r))).toEqual([
        [0.25, 0.5],
        [0.75, 1],
      ]);
    });

    it("tags each row with its source index", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      expect(heatmap.getRows().map((r: $TSFixMe) => r.idx)).toEqual([0, 1]);
    });

    it("skips hidden rows and preserves the original index of those kept", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      heatmap.rowLabels[0].hidden = true;
      const rows = heatmap.getRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].idx).toBe(1);
    });

    it("transposes into columns", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      expect(heatmap.getColumns().map((c: $TSFixMe) => Array.from(c))).toEqual([
        [0.25, 0.75],
        [0.5, 1],
      ]);
    });

    it("substitutes nullValue for null entries", () => {
      const data: $TSFixMe = baseData();
      data.values = [
        [null, 2],
        [3, 4],
      ];
      const heatmap = buildHeatmap(data, { nullValue: 4 });
      parseAndFilter(heatmap);
      // nullValue 4 scales to the top of the 0..4 range.
      expect(heatmap.getRows()[0][0]).toBe(1);
    });
  });

  describe("pinned columns", () => {
    it("partitions columns into pinned and unpinned", () => {
      const data = baseData();
      (data.columnLabels[0] as $TSFixMe).pinned = true;
      const heatmap = buildHeatmap(data, {});
      parseAndFilter(heatmap);
      expect(heatmap.getPinnedColumns().map((c: $TSFixMe) => c.label)).toEqual([
        "cB",
      ]);
      expect(
        heatmap.getUnpinnedColumns().map((c: $TSFixMe) => c.label),
      ).toEqual(["cA"]);
    });

    it("returns values for unpinned columns only, compacted", () => {
      const data = baseData();
      (data.columnLabels[0] as $TSFixMe).pinned = true;
      const heatmap = buildHeatmap(data, {});
      parseAndFilter(heatmap);
      // Only column index 1 (cA) survives; compact() removes the hole left by
      // the pinned column.
      expect(
        heatmap.getUnpinnedColumnValues().map((c: $TSFixMe) => Array.from(c)),
      ).toEqual([[0.5, 1]]);
    });
  });

  describe("getDepth", () => {
    it("returns 0 for a null tree", () => {
      const heatmap = buildHeatmap(baseData(), {});
      expect(heatmap.getDepth(null)).toBe(0);
    });

    it("returns 0 for a lone leaf", () => {
      const heatmap = buildHeatmap(baseData(), {});
      expect(heatmap.getDepth({ value: { idx: 0 } })).toBe(0);
    });

    it("returns the longest root-to-leaf path of an unbalanced tree", () => {
      const heatmap = buildHeatmap(baseData(), {});
      const deep = {
        left: { left: { left: { value: { idx: 0 } } } },
        right: { value: { idx: 1 } },
      };
      expect(heatmap.getDepth(deep)).toBe(3);
    });
  });

  describe("setOrder", () => {
    it("assigns positions by in-order traversal of the cluster tree", () => {
      const heatmap = buildHeatmap(baseData(), {});
      const root = {
        left: { value: { idx: 0 } },
        right: { value: { idx: 1 } },
      };
      const labels = [{ label: "x" }, { label: "y" }];
      expect(posByLabel(heatmap.setOrder(root, labels))).toEqual({
        x: 0,
        y: 1,
      });
    });

    it("maps tree order onto label indices rather than assuming input order", () => {
      const heatmap = buildHeatmap(baseData(), {});
      // Leaf for label index 1 sits on the left, so it must get pos 0.
      const root = {
        left: { value: { idx: 1 } },
        right: { value: { idx: 0 } },
      };
      const labels = [{ label: "x" }, { label: "y" }];
      expect(posByLabel(heatmap.setOrder(root, labels))).toEqual({
        x: 1,
        y: 0,
      });
    });

    it("starts numbering at the supplied offset", () => {
      const heatmap = buildHeatmap(baseData(), {});
      const root = {
        left: { value: { idx: 0 } },
        right: { value: { idx: 1 } },
      };
      const labels = [{ label: "x" }, { label: "y" }];
      expect(posByLabel(heatmap.setOrder(root, labels, 5))).toEqual({
        x: 5,
        y: 6,
      });
    });
  });

  describe("sortTree", () => {
    it("returns without throwing for a null root", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      expect(() => heatmap.sortTree(null)).not.toThrow();
    });

    it("sets a leaf mean from the scaled values", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      const root: $TSFixMe = { left: { value: [0] }, right: { value: [4] } };
      heatmap.sortTree(root);
      // limits are 0..4, so raw 4 scales to 1 and raw 0 scales to 0.
      expect(root.left.mean).toBe(1);
      expect(root.right.mean).toBe(0);
    });

    it("swaps children so the higher-mean branch sorts first", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      const lowLeaf: $TSFixMe = { value: [0] };
      const highLeaf: $TSFixMe = { value: [4] };
      const root: $TSFixMe = { left: lowLeaf, right: highLeaf };
      heatmap.sortTree(root);
      expect(root.left).toBe(highLeaf);
      expect(root.right).toBe(lowLeaf);
      // The parent inherits the mean of its (new) left child.
      expect(root.mean).toBe(1);
    });

    it("leaves children alone when the left branch already ranks higher", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      const highLeaf: $TSFixMe = { value: [4] };
      const lowLeaf: $TSFixMe = { value: [0] };
      const root: $TSFixMe = { left: highLeaf, right: lowLeaf };
      heatmap.sortTree(root);
      expect(root.left).toBe(highLeaf);
    });
  });

  describe("clusterRows / clusterColumns", () => {
    it("clusters rows and gives every row a distinct position", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      heatmap.clusterRows();
      expect(heatmap.rowClustering).toBeTruthy();
      expect(heatmap.rowLabels.map((r: $TSFixMe) => r.pos).sort()).toEqual([
        0, 1,
      ]);
    });

    it("clusters columns and gives every column a distinct position", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      heatmap.clusterColumns();
      expect(heatmap.columnClustering).toBeTruthy();
      expect(heatmap.columnLabels.map((c: $TSFixMe) => c.pos).sort()).toEqual([
        0, 1,
      ]);
    });

    it("places pinned columns ahead of clustered unpinned ones", () => {
      const data = baseData();
      (data.columnLabels[1] as $TSFixMe).pinned = true;
      const heatmap = buildHeatmap(data, { onPinColumnClick: () => undefined });
      parseAndFilter(heatmap);
      heatmap.clusterColumns();
      // cA is pinned, so it takes pos 0 regardless of clustering.
      expect(posByLabel(heatmap.columnLabels)).toEqual({ cA: 0, cB: 1 });
    });
  });

  describe("sortColumns", () => {
    it("orders columns alphabetically ascending", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      heatmap.sortColumns("asc");
      expect(posByLabel(heatmap.columnLabels)).toEqual({ cA: 0, cB: 1 });
    });

    it("orders columns alphabetically descending", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      heatmap.sortColumns("desc");
      expect(posByLabel(heatmap.columnLabels)).toEqual({ cB: 0, cA: 1 });
    });

    it("clears any existing column clustering", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      heatmap.clusterColumns();
      expect(heatmap.columnClustering).toBeTruthy();
      heatmap.sortColumns("asc");
      expect(heatmap.columnClustering).toBeNull();
    });

    it("keeps pinned columns first when pinning is enabled", () => {
      const data = baseData();
      (data.columnLabels[1] as $TSFixMe).pinned = true;
      const heatmap = buildHeatmap(data, { onPinColumnClick: () => undefined });
      parseAndFilter(heatmap);
      heatmap.sortColumns("asc");
      expect(posByLabel(heatmap.columnLabels)).toEqual({ cA: 0, cB: 1 });
    });
  });

  describe("sortRows", () => {
    it("orders rows ascending by sortKey", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      heatmap.sortRows("asc");
      expect(posByLabel(heatmap.filteredRowLabels)).toEqual({
        alpha: 0,
        beta: 1,
      });
    });

    it("clears any existing row clustering", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      heatmap.clusterRows();
      expect(heatmap.rowClustering).toBeTruthy();
      heatmap.sortRows("asc");
      expect(heatmap.rowClustering).toBeNull();
    });

    // NOTE: this documents a live defect rather than endorsing it. sortRows
    // calls lodash orderBy but discards the returned array (orderBy is pure and
    // does not sort in place), then numbers filteredRowLabels in their existing
    // order -- so `direction` has no effect. It currently goes unnoticed because
    // cluster() only ever calls sortRows("asc"), and filterData already leaves
    // filteredRowLabels in ascending sortKey order. Compare sortColumns, which
    // correctly chains .forEach onto the orderBy result. Change this assertion
    // to expect { alpha: 1, beta: 0 } once the defect is fixed.
    it("does not currently honour a descending direction (known defect)", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      heatmap.sortRows("desc");
      expect(posByLabel(heatmap.filteredRowLabels)).toEqual({
        alpha: 0,
        beta: 1,
      });
    });
  });

  describe("cluster", () => {
    it("sorts rows instead of clustering them when shouldSortRows is set", () => {
      const heatmap = buildHeatmap(baseData(), { shouldSortRows: true });
      parseAndFilter(heatmap);
      heatmap.cluster();
      expect(heatmap.rowClustering).toBeNull();
      expect(posByLabel(heatmap.filteredRowLabels)).toEqual({
        alpha: 0,
        beta: 1,
      });
    });

    it("sorts columns instead of clustering them when shouldSortColumns is set", () => {
      const heatmap = buildHeatmap(baseData(), { shouldSortColumns: true });
      parseAndFilter(heatmap);
      heatmap.cluster();
      expect(heatmap.columnClustering).toBeNull();
      expect(posByLabel(heatmap.columnLabels)).toEqual({ cA: 0, cB: 1 });
    });

    it("clusters both axes when clustering is enabled", () => {
      const heatmap = buildHeatmap(baseData(), { clustering: true });
      parseAndFilter(heatmap);
      heatmap.cluster();
      expect(heatmap.rowClustering).toBeTruthy();
      expect(heatmap.columnClustering).toBeTruthy();
    });

    it("does neither when clustering and sorting are all disabled", () => {
      const heatmap = buildHeatmap(baseData(), { clustering: false });
      parseAndFilter(heatmap);
      heatmap.cluster();
      expect(heatmap.rowClustering).toBeUndefined();
      expect(heatmap.columnClustering).toBeUndefined();
    });

    it("orders columns by the metadata sort field, ascending", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      heatmap.columnMetadataSortField = "sample_type";
      heatmap.columnMetadataSortAsc = true;
      heatmap.cluster();
      // blood (cB) sorts before stool (cA); metadata sort wins over clustering.
      expect(heatmap.columnClustering).toBeNull();
      expect(posByLabel(heatmap.columnLabels)).toEqual({ cB: 0, cA: 1 });
    });

    it("orders columns by the metadata sort field, descending", () => {
      const heatmap = buildHeatmap(baseData(), {});
      parseAndFilter(heatmap);
      heatmap.columnMetadataSortField = "sample_type";
      heatmap.columnMetadataSortAsc = false;
      heatmap.cluster();
      expect(posByLabel(heatmap.columnLabels)).toEqual({ cA: 0, cB: 1 });
    });

    it("sorts columns missing the metadata field last", () => {
      const data = baseData();
      // Capitalised values, as the sentinel below implicitly assumes.
      (data.columnLabels[0] as $TSFixMe).metadata = {};
      (data.columnLabels[1] as $TSFixMe).metadata = { sample_type: "Stool" };
      const heatmap = buildHeatmap(data, {});
      parseAndFilter(heatmap);
      heatmap.columnMetadataSortField = "sample_type";
      heatmap.columnMetadataSortAsc = true;
      heatmap.cluster();
      // cB has no sample_type so it falls back to the "ZZZ" sentinel and sinks.
      expect(posByLabel(heatmap.columnLabels)).toEqual({ cA: 0, cB: 1 });
    });

    // NOTE: this documents a live defect rather than endorsing it. Columns with
    // no value for the sort field fall back to a literal "ZZZ" sentinel that is
    // meant to sort them last. The comparison is a plain case-sensitive string
    // compare, so the sentinel only sinks past values that start with an
    // uppercase letter: "ZZZ" < "stool" because 'Z' is 90 and 's' is 115. With
    // lowercase metadata values, columns missing the field surface FIRST in an
    // ascending sort -- the opposite of the intent. Flip this expectation to
    // { cA: 0, cB: 1 } once the sentinel is made case-insensitive.
    it("does not sink missing metadata past lowercase values (known defect)", () => {
      const data = baseData();
      (data.columnLabels[0] as $TSFixMe).metadata = {};
      const heatmap = buildHeatmap(data, {});
      parseAndFilter(heatmap);
      heatmap.columnMetadataSortField = "sample_type";
      heatmap.columnMetadataSortAsc = true;
      heatmap.cluster();
      // cB is the one MISSING sample_type, yet it lands first.
      expect(posByLabel(heatmap.columnLabels)).toEqual({ cB: 0, cA: 1 });
    });

    it("keeps pinned columns first during a metadata sort", () => {
      const data = baseData();
      // cA is pinned but sorts last by metadata; pinning must still win.
      (data.columnLabels[1] as $TSFixMe).pinned = true;
      const heatmap = buildHeatmap(data, { onPinColumnClick: () => undefined });
      parseAndFilter(heatmap);
      heatmap.columnMetadataSortField = "sample_type";
      heatmap.columnMetadataSortAsc = true;
      heatmap.cluster();
      expect(posByLabel(heatmap.columnLabels)).toEqual({ cA: 0, cB: 1 });
    });
  });

  describe("processMetadata / getColumnMetadataLegend", () => {
    const metadataOptions = {
      columnMetadata: [{ label: "Sample Type", value: "sample_type" }],
    };

    it("assigns a distinct colour to each distinct metadata value", () => {
      const heatmap = buildHeatmap(baseData(), metadataOptions);
      parseAndFilter(heatmap);
      heatmap.processMetadata();
      const colorMap = heatmap.metadataColors.sample_type;
      expect(Object.keys(colorMap).sort()).toEqual(["blood", "stool"]);
      expect(colorMap.blood).not.toEqual(colorMap.stool);
    });

    it("returns the colour map unchanged when every column has the field", () => {
      const heatmap = buildHeatmap(baseData(), metadataOptions);
      parseAndFilter(heatmap);
      heatmap.processMetadata();
      expect(heatmap.getColumnMetadataLegend("sample_type")).toEqual(
        heatmap.metadataColors.sample_type,
      );
    });

    it("adds an Unknown entry when a column is missing the field", () => {
      const data = baseData();
      (data.columnLabels[1] as $TSFixMe).metadata = {};
      const heatmap = buildHeatmap(data, metadataOptions);
      parseAndFilter(heatmap);
      heatmap.processMetadata();
      const legend = heatmap.getColumnMetadataLegend("sample_type");
      expect(legend.Unknown).toBe("#eaeaea");
      expect(legend.blood).toBeDefined();
      expect(legend.stool).toBeUndefined();
    });

    it("tolerates columns with no metadata object at all", () => {
      const data = baseData();
      delete (data.columnLabels[1] as $TSFixMe).metadata;
      const heatmap = buildHeatmap(data, metadataOptions);
      parseAndFilter(heatmap);
      expect(() => heatmap.processMetadata()).not.toThrow();
      expect(heatmap.getColumnMetadataLegend("sample_type").Unknown).toBe(
        "#eaeaea",
      );
    });
  });

  describe("handleColumnMetadataLabelClick", () => {
    const buildSorted = (onColumnMetadataSortChange?: $TSFixMe) => {
      const heatmap = buildHeatmap(baseData(), {
        columnMetadata: [{ label: "Sample Type", value: "sample_type" }],
        onColumnMetadataSortChange,
      });
      heatmap.start();
      return heatmap;
    };

    it("cycles a field through ascending, descending, then unsorted", () => {
      const heatmap = buildSorted();

      heatmap.handleColumnMetadataLabelClick("sample_type");
      expect(heatmap.columnMetadataSortField).toBe("sample_type");
      expect(heatmap.columnMetadataSortAsc).toBe(true);

      heatmap.handleColumnMetadataLabelClick("sample_type");
      expect(heatmap.columnMetadataSortField).toBe("sample_type");
      expect(heatmap.columnMetadataSortAsc).toBe(false);

      // Third click clears the sort entirely and resets the direction.
      heatmap.handleColumnMetadataLabelClick("sample_type");
      expect(heatmap.columnMetadataSortField).toBeNull();
      expect(heatmap.columnMetadataSortAsc).toBe(true);
    });

    it("switching to a different field restarts at ascending", () => {
      const heatmap = buildSorted();
      heatmap.handleColumnMetadataLabelClick("sample_type");
      heatmap.handleColumnMetadataLabelClick("sample_type");
      expect(heatmap.columnMetadataSortAsc).toBe(false);

      heatmap.handleColumnMetadataLabelClick("nucleotide_type");
      expect(heatmap.columnMetadataSortField).toBe("nucleotide_type");
      expect(heatmap.columnMetadataSortAsc).toBe(true);
    });

    it("notifies the caller of each sort change", () => {
      const onColumnMetadataSortChange = jest.fn();
      const heatmap = buildSorted(onColumnMetadataSortChange);
      heatmap.handleColumnMetadataLabelClick("sample_type");
      heatmap.handleColumnMetadataLabelClick("sample_type");
      expect(onColumnMetadataSortChange.mock.calls).toEqual([
        ["sample_type", true],
        ["sample_type", false],
      ]);
    });
  });

  describe("getZoomFactor", () => {
    it("returns the explicit zoom when one is set", () => {
      const heatmap = buildHeatmap(baseData(), { zoom: 2 });
      expect(heatmap.getZoomFactor()).toBe(2);
    });

    it("shrinks to fit when the heatmap is wider than maxWidth", () => {
      const heatmap = buildHeatmap(baseData(), { maxWidth: 1600 });
      heatmap.width = 3200;
      // maxWidth is trimmed by 8px to avoid provoking a scrollbar.
      expect(heatmap.getZoomFactor()).toBeCloseTo(1592 / 3200);
    });

    it("does not scale up a heatmap narrower than maxWidth", () => {
      const heatmap = buildHeatmap(baseData(), { maxWidth: 1600 });
      heatmap.width = 100;
      expect(heatmap.getZoomFactor()).toBe(1);
    });
  });

  describe("computeCurrentHeatmapViewValuesForCSV", () => {
    it("emits a header row and one row per taxon in display order", () => {
      const heatmap = buildHeatmap(baseData(), { clustering: false });
      heatmap.start();
      const [headers, rows] = heatmap.computeCurrentHeatmapViewValuesForCSV({
        headers: ["Taxon"],
      });
      expect(headers).toEqual(["Taxon,cB,cA"]);
      expect(rows).toEqual([["beta,1,2"], ["alpha,3,4"]]);
    });

    it("includes the genus column only when the Genus header is requested", () => {
      const heatmap = buildHeatmap(baseData(), { clustering: false });
      heatmap.start();
      const [headers, rows] = heatmap.computeCurrentHeatmapViewValuesForCSV({
        headers: ["Taxon", "Genus"],
      });
      expect(headers).toEqual(["Taxon,Genus,cB,cA"]);
      expect(rows).toEqual([["beta,genusB,1,2"], ["alpha,genusA,3,4"]]);
    });

    it("writes NA for cells the user's filters exclude", () => {
      const data: $TSFixMe = baseData();
      data.rowLabels[0].filterStateRow = "R0";
      data.rowLabels[1].filterStateRow = "R1";
      data.columnLabels[0].filterStateColumn = "C0";
      data.columnLabels[1].filterStateColumn = "C1";
      data.taxonFilterState = {
        R0: { C0: true, C1: false },
        R1: { C0: true, C1: true },
      };
      const heatmap = buildHeatmap(data, { clustering: false });
      heatmap.start();
      const [, rows] = heatmap.computeCurrentHeatmapViewValuesForCSV({
        headers: ["Taxon"],
      });
      // beta/cA is filtered out, so its value is masked rather than dropped.
      expect(rows).toEqual([["beta,1,NA"], ["alpha,3,4"]]);
    });

    it("writes 0 for cells absent from the filtered set", () => {
      const data: $TSFixMe = baseData();
      data.values = [
        [1, null],
        [3, 4],
      ];
      const heatmap = buildHeatmap(data, { clustering: false });
      heatmap.start();
      const [, rows] = heatmap.computeCurrentHeatmapViewValuesForCSV({
        headers: ["Taxon"],
      });
      expect(rows).toEqual([["beta,1,0"], ["alpha,3,4"]]);
    });

    it("neutralises spreadsheet formula injection in labels", () => {
      const data: $TSFixMe = baseData();
      data.rowLabels[0].label = "=cmd|'/c calc'!A1";
      const heatmap = buildHeatmap(data, { clustering: false });
      heatmap.start();
      const [, rows] = heatmap.computeCurrentHeatmapViewValuesForCSV({
        headers: ["Taxon"],
      });
      // sanitizeCSVRow must defuse the leading "=" so Excel treats it as text.
      expect(rows[0][0]).not.toMatch(/^=/);
    });
  });

  describe("update helpers", () => {
    it("updateScale swaps the scale type and reprocesses", () => {
      const heatmap = buildHeatmap(baseData(), {});
      heatmap.start();
      heatmap.updateScale("symlog");
      expect(heatmap.options.scale).toBe("symlog");
      const scale = heatmap.scaleType().domain([0, 10]).range([0, 1]);
      expect(scale(5)).not.toBeCloseTo(0.5);
    });

    it("updateZoom records the zoom and resizes the svg", () => {
      const heatmap = buildHeatmap(baseData(), {});
      heatmap.start();
      heatmap.updateZoom(2);
      expect(heatmap.options.zoom).toBe(2);
      expect(Number(heatmap.svg.attr("width"))).toBe(heatmap.width * 2);
      expect(Number(heatmap.svg.attr("height"))).toBe(heatmap.height * 2);
    });

    it("updateSortColumns re-sorts the columns", () => {
      const heatmap = buildHeatmap(baseData(), {});
      heatmap.start();
      heatmap.updateSortColumns(true);
      expect(heatmap.options.shouldSortColumns).toBe(true);
      expect(posByLabel(heatmap.columnLabels)).toEqual({ cA: 0, cB: 1 });
    });

    it("updateSortRows re-sorts the rows", () => {
      const heatmap = buildHeatmap(baseData(), {});
      heatmap.start();
      heatmap.updateSortRows(true);
      expect(heatmap.options.shouldSortRows).toBe(true);
      expect(posByLabel(heatmap.filteredRowLabels)).toEqual({
        alpha: 0,
        beta: 1,
      });
    });

    it("updateData merges new values and rebuilds the cells", () => {
      const heatmap = buildHeatmap(baseData(), {});
      heatmap.start();
      heatmap.updateData({
        values: [
          [10, 20],
          [30, 40],
        ],
      });
      expect(heatmap.cells.map((c: $TSFixMe) => c.value)).toEqual([
        10, 20, 30, 40,
      ]);
      expect(heatmap.limits).toEqual({ min: 0, max: 40 });
    });

    it("updateColumnMetadata records the metadata and rebuilds the colour map", () => {
      const heatmap = buildHeatmap(baseData(), {});
      heatmap.start();
      heatmap.updateColumnMetadata([
        { label: "Sample Type", value: "sample_type" },
      ]);
      expect(heatmap.options.columnMetadata).toEqual([
        { label: "Sample Type", value: "sample_type" },
      ]);
      expect(Object.keys(heatmap.metadataColors.sample_type).sort()).toEqual([
        "blood",
        "stool",
      ]);
    });

    it("updatePrintCaption stores the caption without reprocessing", () => {
      const heatmap = buildHeatmap(baseData(), {});
      heatmap.start();
      heatmap.updatePrintCaption(["line one", "line two"]);
      expect(heatmap.options.printCaption).toEqual(["line one", "line two"]);
    });
  });

  describe("start", () => {
    it("renders an svg with one cell rect per non-null value", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const heatmap = new Heatmap(container, baseData() as $TSFixMe, {});
      heatmap.start();
      expect(container.querySelectorAll("svg")).toHaveLength(1);
      // The cell grid holds exactly the filtered cells.
      expect(heatmap.filteredCells).toHaveLength(4);
      expect(
        heatmap.gCells.node().querySelectorAll("rect").length,
      ).toBeGreaterThanOrEqual(4);
    });

    it("invokes the onUpdateFinished callback once the render completes", () => {
      const onUpdateFinished = jest.fn();
      const heatmap = buildHeatmap(baseData(), { onUpdateFinished });
      heatmap.start();
      expect(onUpdateFinished).toHaveBeenCalledTimes(1);
    });

    it("renders an empty dataset without throwing", () => {
      const heatmap = buildHeatmap(
        { rowLabels: [], columnLabels: [], values: [] },
        { clustering: false },
      );
      expect(() => heatmap.start()).not.toThrow();
    });
  });
});

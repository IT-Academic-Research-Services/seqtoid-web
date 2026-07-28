// Branch coverage: app/assets/src/components/visualizations/heatmap/Heatmap.ts
//
// jest/Heatmap.test.ts covers the data pipeline and
// jest/heatmap-Heatmap-rendering.test.ts covers the happy-path render. This
// file targets the conditionals neither of them reaches: the switch default in
// processData, the `|| label.label` sort fallbacks, the scroll-in-progress
// guard in placeContainers, the pinned-column metadata sort (including its
// "ZZZ" fallback and its descending direction), the nullValue substitution in
// getUnpinnedColumnValues, the default `headers` argument and the "NA" cell of
// the CSV export, the colorNoValue escape hatch in the cell fill callback, the
// no-op second pass of the three "add link" renderers, and the
// neither-row-nor-column arm of highlightRowOrColumn.
//
// The jsdom shims below are the same ones the rendering spec uses and hide no
// product behaviour: jsdom has no SVG layout engine (getBBox) and does not
// implement CSS.escape, which renderColumnMetadataCells calls.
jest.mock(
  "../app/assets/src/components/visualizations/heatmap/heatmap.scss",
  () => {
    const overrides: Record<string, string> = { primaryLight: "#3867fa" };
    return new Proxy(overrides, {
      get: (target, prop) => {
        if (typeof prop !== "string") return undefined;
        if (prop === "__esModule" || prop === "default") return undefined;
        return prop in target ? target[prop] : prop;
      },
    });
  },
);

jest.mock("svgsaver", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    asSvg: jest.fn(),
    asPng: jest.fn(),
  })),
}));

import Heatmap from "../app/assets/src/components/visualizations/heatmap/Heatmap";

if (typeof (global as $TSFixMe).CSS === "undefined") {
  (global as $TSFixMe).CSS = {
    escape: (value: string) =>
      String(value).replace(/([^a-zA-Z0-9_-])/g, "\\$1"),
  };
}

beforeAll(() => {
  (SVGElement.prototype as unknown as { getBBox: () => unknown }).getBBox =
    () => ({ x: 0, y: 0, width: 40, height: 12 });
});

const METADATA_FIELDS = [{ value: "sample_type", label: "Sample Type" }];

// Three rows / three columns, deliberately not in label order. "cC" carries an
// empty metadata object so the metadata sort has to fall back to "ZZZ".
const baseData = () => ({
  rowLabels: [
    { label: "beta", genusName: "genusB", sortKey: 2 },
    { label: "alpha", genusName: "genusA", sortKey: 1 },
    { label: "gamma", genusName: "genusB", sortKey: 3 },
  ],
  columnLabels: [
    { label: "cB", id: 1, metadata: { sample_type: "blood" }, pinned: false },
    { label: "cA", id: 2, metadata: { sample_type: "stool" }, pinned: false },
    { label: "cC", id: 3, metadata: {}, pinned: false },
  ],
  values: [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ],
});

let container: HTMLElement;

const build = (options: $TSFixMe = {}, data: $TSFixMe = baseData()) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  return new Heatmap(container as HTMLElement, data, options);
};

const started = (options: $TSFixMe = {}, data: $TSFixMe = baseData()) => {
  const heatmap = build(options, data);
  heatmap.start();
  return heatmap;
};

const $$ = (selector: string) =>
  Array.from(container.querySelectorAll(selector));

// pos is the only thing that determines rendered order.
const posOf = (labels: $TSFixMe[], label: string) =>
  labels.find((l: $TSFixMe) => l.label === label).pos;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Heatmap.processData step selection", () => {
  it("runs the whole pipeline when no starting step is given", () => {
    const heatmap = build();
    heatmap.processData();
    expect($$("svg#visualization")).toHaveLength(1);
    expect($$("rect.cell")).toHaveLength(9);
  });

  it("does nothing for a starting step it does not recognise", () => {
    const heatmap = build();
    heatmap.processData("notAStep" as $TSFixMe);
    // The default arm breaks immediately: no container, no parsed data.
    expect($$("svg#visualization")).toHaveLength(0);
    expect(heatmap.svg).toBeNull();
    expect(heatmap.cells).toBeUndefined();
    expect(heatmap.filteredCells).toBeUndefined();
  });
});

describe("Heatmap row ordering when sortKey is absent", () => {
  const unkeyedData = () => ({
    ...baseData(),
    rowLabels: [
      { label: "cc", genusName: "g" },
      { label: "aa", genusName: "g" },
      { label: "bb", genusName: "g" },
    ],
  });

  it("falls back to the label when filterData finds no sortKey", () => {
    const heatmap = build({}, unkeyedData());
    heatmap.parseData();
    heatmap.filterData();
    expect(heatmap.filteredRowLabels.map((r: $TSFixMe) => r.label)).toEqual([
      "aa",
      "bb",
      "cc",
    ]);
  });

  it("still falls back to the label when sortKey is zero", () => {
    const data = unkeyedData();
    data.rowLabels = data.rowLabels.map(row => ({ ...row, sortKey: 0 }));
    const heatmap = build({}, data);
    heatmap.parseData();
    heatmap.filterData();
    expect(heatmap.filteredRowLabels.map((r: $TSFixMe) => r.label)).toEqual([
      "aa",
      "bb",
      "cc",
    ]);
  });

  it("sortRows renumbers pos over unkeyed rows and drops the clustering", () => {
    const heatmap = build({}, unkeyedData());
    heatmap.parseData();
    heatmap.filterData();
    heatmap.rowClustering = { some: "tree" };
    heatmap.sortRows("asc");
    expect(heatmap.rowClustering).toBeNull();
    expect(heatmap.filteredRowLabels.map((r: $TSFixMe) => r.pos)).toEqual([
      0, 1, 2,
    ]);
  });
});

describe("Heatmap.placeContainers scroll guard", () => {
  it("skips the label placement and clears the flag while a scroll is in progress", () => {
    const heatmap = started({ clustering: false, onAddRowClick: jest.fn() });
    const placeAddRowLinkContainer = jest.spyOn(
      heatmap,
      "placeAddRowLinkContainer",
    );
    const placeColumnLabels = jest.spyOn(
      heatmap,
      "placeColumnLabelAndMetadataContainers",
    );

    heatmap.scrollToRowInProgess = true;
    heatmap.placeContainers();

    expect(placeAddRowLinkContainer).not.toHaveBeenCalled();
    expect(placeColumnLabels).not.toHaveBeenCalled();
    // The flag is one-shot: the next placement pass runs normally again.
    expect(heatmap.scrollToRowInProgess).toBe(false);

    heatmap.placeContainers();
    expect(placeAddRowLinkContainer).toHaveBeenCalled();
    expect(placeColumnLabels).toHaveBeenCalled();
  });
});

describe("Heatmap column metadata sort with pinning enabled", () => {
  const pinnedData = () => {
    const data = baseData();
    data.columnLabels = [
      ...data.columnLabels,
      {
        label: "cP",
        id: 4,
        metadata: { sample_type: "csf" },
        pinned: true,
      },
    ];
    data.values = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
    ];
    return data;
  };

  const buildSortable = () => {
    const onColumnMetadataSortChange = jest.fn();
    const heatmap = started(
      {
        clustering: false,
        enableColumnMetadata: true,
        columnMetadata: METADATA_FIELDS,
        onPinColumnClick: jest.fn(),
        onColumnMetadataSortChange,
      },
      pinnedData(),
    );
    return { heatmap, onColumnMetadataSortChange };
  };

  it("sorts unpinned columns ascending, substituting ZZZ for missing metadata", () => {
    const { heatmap, onColumnMetadataSortChange } = buildSortable();
    heatmap.handleColumnMetadataLabelClick("sample_type");

    expect(heatmap.columnMetadataSortAsc).toBe(true);
    // Pinned column always leads.
    expect(posOf(heatmap.columnLabels, "cP")).toBe(0);
    // cC has no sample_type, so it sorts on the literal "ZZZ". The comparison
    // is a raw string compare, so uppercase "ZZZ" lands ahead of the lowercase
    // metadata values: "ZZZ" < "blood" < "stool".
    expect(posOf(heatmap.columnLabels, "cC")).toBeLessThan(
      posOf(heatmap.columnLabels, "cB"),
    );
    expect(posOf(heatmap.columnLabels, "cB")).toBeLessThan(
      posOf(heatmap.columnLabels, "cA"),
    );
    expect(onColumnMetadataSortChange).toHaveBeenCalledWith(
      "sample_type",
      true,
    );
  });

  it("reverses to descending on the second click, still keeping pins first", () => {
    const { heatmap, onColumnMetadataSortChange } = buildSortable();
    heatmap.handleColumnMetadataLabelClick("sample_type");
    heatmap.handleColumnMetadataLabelClick("sample_type");

    expect(heatmap.columnMetadataSortField).toBe("sample_type");
    expect(heatmap.columnMetadataSortAsc).toBe(false);
    expect(posOf(heatmap.columnLabels, "cP")).toBe(0);
    // Exactly the ascending order reversed: stool, blood, then the "ZZZ"
    // fallback for the column with no sample_type.
    expect(posOf(heatmap.columnLabels, "cA")).toBeLessThan(
      posOf(heatmap.columnLabels, "cB"),
    );
    expect(posOf(heatmap.columnLabels, "cB")).toBeLessThan(
      posOf(heatmap.columnLabels, "cC"),
    );
    expect(onColumnMetadataSortChange).toHaveBeenLastCalledWith(
      "sample_type",
      false,
    );
  });

  it("clears the sort field on the third click", () => {
    const { heatmap } = buildSortable();
    heatmap.handleColumnMetadataLabelClick("sample_type");
    heatmap.handleColumnMetadataLabelClick("sample_type");
    heatmap.handleColumnMetadataLabelClick("sample_type");
    expect(heatmap.columnMetadataSortField).toBeNull();
    expect(heatmap.columnMetadataSortAsc).toBe(true);
  });
});

describe("Heatmap column value extraction", () => {
  it("getColumns omits hidden rows from every column", () => {
    const heatmap = started({ clustering: false });
    heatmap.rowLabels[1].hidden = true;
    const columns = heatmap.getColumns();
    expect(columns).toHaveLength(3);
    columns.forEach((column: $TSFixMe) => expect(column).toHaveLength(2));
    // The un-hidden run still records which column it came from.
    expect(columns.map((column: $TSFixMe) => column.idx)).toEqual([0, 1, 2]);
  });

  it("getUnpinnedColumnValues substitutes nullValue for falsy cell values", () => {
    const data = baseData();
    data.values = [
      [0, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    // nullValue is also the domain max here, so the substituted cell scales to
    // 1 while the genuine values stay proportional.
    const heatmap = started({ clustering: false, nullValue: 9 }, data);
    const columns = heatmap.getUnpinnedColumnValues();

    expect(columns).toHaveLength(3);
    expect(columns[0][0]).toBe(1);
    expect(columns[0][1]).toBeCloseTo(4 / 9);
    expect(columns[0][2]).toBeCloseTo(7 / 9);
  });
});

describe("Heatmap CSV export", () => {
  const parsed = (data: $TSFixMe = baseData(), options: $TSFixMe = {}) => {
    const heatmap = build(options, data);
    heatmap.parseData();
    heatmap.filterData();
    return heatmap;
  };

  it("defaults headers to an empty list when the caller omits them", () => {
    const heatmap = parsed();
    const [headerRows, rows] = heatmap.computeCurrentHeatmapViewValuesForCSV(
      {},
    );
    // No "Genus" header means no genus column on any row.
    expect(headerRows).toEqual(["cB,cA,cC"]);
    expect(rows).toEqual([["beta,1,2,3"], ["alpha,4,5,6"], ["gamma,7,8,9"]]);
  });

  it("adds the genus column when Genus is passed in headers", () => {
    const heatmap = parsed();
    const [headerRows, rows] = heatmap.computeCurrentHeatmapViewValuesForCSV({
      headers: ["Genus"],
    });
    expect(headerRows).toEqual(["Genus,cB,cA,cC"]);
    expect(rows[0]).toEqual(["beta,genusB,1,2,3"]);
  });

  it("writes NA for cells the user filters exclude", () => {
    const data: $TSFixMe = {
      rowLabels: [
        { label: "beta", genusName: "genusB", sortKey: 2, filterStateRow: 0 },
        { label: "alpha", genusName: "genusA", sortKey: 1, filterStateRow: 1 },
      ],
      columnLabels: [
        { label: "cB", id: 1, metadata: {}, filterStateColumn: 0 },
        { label: "cA", id: 2, metadata: {}, filterStateColumn: 1 },
      ],
      values: [
        [1, 2],
        [3, 4],
      ],
      taxonFilterState: [
        [true, false],
        [true, true],
      ],
    };
    const heatmap = parsed(data);
    const [, rows] = heatmap.computeCurrentHeatmapViewValuesForCSV({});
    expect(rows).toEqual([["beta,1,NA"], ["alpha,3,4"]]);
  });
});

describe("Heatmap.showPrintCaption", () => {
  // renderCaption feeds this.options.printCaption straight into d3's data()
  // join, which cannot take a non-array. It is stubbed so the height maths --
  // the thing the conditional actually controls -- can be observed on its own.
  it("reserves no extra svg height once the print caption is cleared", () => {
    const heatmap = started({
      clustering: false,
      zoom: 2,
      printCaption: ["line one", "line two"],
    });
    const renderCaption = jest
      .spyOn(heatmap, "renderCaption")
      .mockImplementation(() => undefined);

    heatmap.showPrintCaption();
    const withCaption = Number(heatmap.svg.attr("height"));

    heatmap.updatePrintCaption(null);
    heatmap.showPrintCaption();
    const withoutCaption = Number(heatmap.svg.attr("height"));

    expect(withCaption).toBe(
      (heatmap.height + 2 * (heatmap.options.captionLineHeight + 1)) * 2,
    );
    expect(withoutCaption).toBe(heatmap.height * 2);
    expect(withCaption).toBeGreaterThan(withoutCaption);
    expect(renderCaption).toHaveBeenCalledTimes(2);
  });
});

describe("Heatmap cell fill fallback", () => {
  it("paints colorNoValue for a cell whose value is neither a number nor zero", () => {
    const data = baseData();
    // NaN survives filterData (NaN != null) but has no place on the scale.
    data.values = [
      [NaN, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const heatmap = started(
      { clustering: false, colorNoValue: "rgb(1, 2, 3)" },
      data,
    );

    const fills = $$("rect.cell").map(node => (node as SVGElement).style.fill);
    expect(fills).toHaveLength(9);
    expect(fills.filter(fill => fill === "rgb(1, 2, 3)")).toHaveLength(1);
    // A zero-valued cell takes the real ramp, not the no-value colour.
    expect(heatmap.options.colors).not.toContain("rgb(1, 2, 3)");
  });

  it("paints a zero-valued cell from the colour ramp, not colorNoValue", () => {
    const data = baseData();
    data.values = [
      [0, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const heatmap = started(
      { clustering: false, colorNoValue: "rgb(1, 2, 3)" },
      data,
    );
    const fills = $$("rect.cell").map(node => (node as SVGElement).style.fill);
    expect(fills).toHaveLength(9);
    expect(fills).not.toContain("rgb(1, 2, 3)");
    fills.forEach(fill => expect(heatmap.options.colors).toContain(fill));
  });
});

describe("Heatmap add-link renderers on a second pass", () => {
  const withLinks = () =>
    started({
      clustering: false,
      enableColumnMetadata: true,
      columnMetadata: METADATA_FIELDS,
      onAddRowClick: jest.fn(),
      onPinColumnClick: jest.fn(),
      onAddColumnMetadataClick: jest.fn(),
    });

  it("keeps the existing trigger nodes instead of appending duplicates", () => {
    const heatmap = withLinks();
    const addRowTrigger = heatmap.addRowTrigger;
    const pinColumnTrigger = heatmap.pinColumnTrigger;
    const addMetadataTrigger = heatmap.addMetadataTrigger;
    expect(addRowTrigger).not.toBeNull();
    expect(pinColumnTrigger).not.toBeNull();
    expect(addMetadataTrigger).not.toBeNull();

    const linkCount = $$("g.columnMetadataAdd").length;
    const triggerCount = $$("g.metadataAddTrigger").length;

    // The enter selection is empty this time, so the trigger assignment is
    // skipped and the already-mounted nodes are reused.
    heatmap.renderRowAddLink(0);
    heatmap.renderPinColumnLink();
    heatmap.renderColumnMetadataAddLink(0);

    expect(heatmap.addRowTrigger).toBe(addRowTrigger);
    expect(heatmap.pinColumnTrigger).toBe(pinColumnTrigger);
    expect(heatmap.addMetadataTrigger).toBe(addMetadataTrigger);
    expect($$("g.columnMetadataAdd")).toHaveLength(linkCount);
    expect($$("g.metadataAddTrigger")).toHaveLength(triggerCount);
  });

  it("renders no add links at all when the callbacks are absent", () => {
    started({ clustering: false });
    expect($$("g.columnMetadataAdd")).toHaveLength(0);
  });
});

describe("Heatmap.renderColumnMetadataLabels default transition", () => {
  it("re-renders the metadata labels when called without a transition flag", () => {
    const heatmap = started({
      clustering: false,
      enableColumnMetadata: true,
      columnMetadata: METADATA_FIELDS,
    });
    const before = $$("g.columnMetadataLabel").length;
    expect(before).toBe(1);

    heatmap.renderColumnMetadataLabels(0);

    const labels = $$("g.columnMetadataLabel");
    expect(labels).toHaveLength(1);
    expect(labels[0].querySelector("text")?.textContent).toBe("Sample Type");
  });
});

describe("Heatmap.highlightRowOrColumn", () => {
  it("draws overlays above and below a highlighted row", () => {
    const heatmap = started({ clustering: false });
    heatmap.highlightRowOrColumn(heatmap.rowLabels[0]);
    expect(heatmap.overlays).toHaveLength(2);
  });

  it("draws overlays left and right of a highlighted column", () => {
    const heatmap = started({ clustering: false });
    heatmap.highlightRowOrColumn(heatmap.columnLabels[0]);
    expect(heatmap.overlays).toHaveLength(2);
  });

  it("draws nothing for a target that is neither a row nor a column", () => {
    const heatmap = started({ clustering: false });
    heatmap.highlightRowOrColumn(heatmap.rowLabels[0]);
    expect(heatmap.overlays).toHaveLength(2);

    // No rowIndex and no columnIndex: previous overlays are cleared and no new
    // ones are drawn.
    heatmap.highlightRowOrColumn({ pos: 0 });
    expect(heatmap.overlays).toHaveLength(0);
    expect(heatmap.overlaysDebounce).toBe(false);
  });
});

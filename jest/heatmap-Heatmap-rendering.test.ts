// Frontend coverage: app/assets/src/components/visualizations/heatmap/Heatmap.ts
//
// jest/Heatmap.test.ts already covers the data pipeline (parse / filter /
// cluster / sort / CSV). This file covers the other half of the class -- the
// rendering pass and the interaction handlers -- by actually running
// `heatmap.start()` against a jsdom container and then asserting on the SVG it
// produced and on how the handlers mutate it.
//
// Two jsdom gaps are shimmed. Neither hides product behaviour:
//   1. jsdom has no SVG layout engine, so getBBox does not exist. Nothing below
//      asserts on the stubbed geometry.
//   2. jsdom does not implement CSS.escape, which renderColumnMetadataCells
//      calls. Every supported browser implements it.
//
// heatmap.scss is mapped to an empty object by jest.config, which would make
// every `cs.foo` undefined -- the colour filter would fail to parse a hex value
// and every class-based selector would collapse to ".undefined". It is replaced
// with a proxy that echoes the key back, so `cs.cell === "cell"` and the
// rendered markup can be queried by the same names the source uses.
jest.mock(
  "../app/assets/src/components/visualizations/heatmap/heatmap.scss",
  () => {
    const overrides: Record<string, string> = { primaryLight: "#3867fa" };
    return new Proxy(overrides, {
      get: (target, prop) => {
        if (typeof prop !== "string") return undefined;
        // Keep babel's ESM interop from mistaking the proxy for a namespace.
        if (prop === "__esModule" || prop === "default") return undefined;
        return prop in target ? target[prop] : prop;
      },
    });
  },
);

const mockAsSvg = jest.fn();
const mockAsPng = jest.fn();
jest.mock("svgsaver", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    asSvg: mockAsSvg,
    asPng: mockAsPng,
  })),
}));

import d3 from "d3";
import Heatmap from "../app/assets/src/components/visualizations/heatmap/Heatmap";

if (typeof (global as $TSFixMe).CSS === "undefined") {
  (global as $TSFixMe).CSS = {
    escape: (value: string) =>
      String(value).replace(/([^a-zA-Z0-9_-])/g, "\\$1"),
  };
}

// d3 v3's `d3.transform` reads `SVGGElement.transform.baseVal`, an interface
// jsdom does not implement at all. It is replaced with a parser over the very
// `translate(x,y)` strings the class itself writes, so pan()'s clamping maths
// stays under test while the unavailable browser API is stood in for.
const parseTranslate = (value: string | null): [number, number] => {
  const match = /translate\(\s*(-?[\d.]+)\s*[, ]\s*(-?[\d.]+)/.exec(
    value || "",
  );
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
};

beforeAll(() => {
  (SVGElement.prototype as unknown as { getBBox: () => unknown }).getBBox =
    () => ({ x: 0, y: 0, width: 40, height: 12 });
  (d3 as $TSFixMe).transform = (value: string) => ({
    translate: parseTranslate(value),
  });
});

// Three rows / three columns, deliberately not in label order so that position
// is distinguishable from input order.
const baseData = () => ({
  rowLabels: [
    { label: "beta", genusName: "genusB", sortKey: 2 },
    { label: "alpha", genusName: "genusA", sortKey: 1 },
    { label: "gamma", genusName: "genusB", sortKey: 2 },
  ],
  columnLabels: [
    {
      label: "cB",
      id: 1,
      metadata: { sample_type: "blood" },
      pinned: false,
      printLabel: "columnB",
    },
    {
      label: "cA",
      id: 2,
      metadata: { sample_type: "stool" },
      pinned: false,
      printLabel: "columnA",
    },
    {
      label: "cC",
      id: 3,
      metadata: {},
      pinned: false,
      printLabel: "columnC",
    },
  ],
  values: [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ],
});

const METADATA_FIELDS = [{ value: "sample_type", label: "Sample Type" }];

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

const texts = (selector: string) => $$(selector).map(node => node.textContent);

afterEach(() => {
  document.body.innerHTML = "";
  mockAsSvg.mockClear();
  mockAsPng.mockClear();
  (d3 as $TSFixMe).event = null;
});

describe("Heatmap.start rendering", () => {
  it("builds the svg scaffolding once", () => {
    started();
    expect($$("svg#visualization")).toHaveLength(1);
    expect($$("svg > defs")).toHaveLength(1);
    expect($$("g.rowLabels")).toHaveLength(1);
    expect($$("g.columnLabels")).toHaveLength(1);
    expect($$("g.captionContainer")).toHaveLength(1);
  });

  it("draws one cell per row/column pair", () => {
    started();
    expect($$("rect.cell")).toHaveLength(9);
  });

  it("drops the cells of rows whose values are all null", () => {
    const data = baseData();
    data.values = [
      [1, 2, 3],
      [null, null, null],
      [7, 8, 9],
    ] as $TSFixMe;
    started({}, data);
    expect($$("rect.cell")).toHaveLength(6);
  });

  it("sizes and positions the cells from the computed cell box", () => {
    const heatmap = started({ clustering: false });
    const cell = $$("rect.cell")[0] as SVGRectElement;
    expect(Number(cell.getAttribute("width"))).toBe(heatmap.cell.width - 2);
    expect(Number(cell.getAttribute("height"))).toBe(heatmap.cell.height - 2);
    // Every cell x lands on a column-position multiple, offset by one.
    $$("rect.cell").forEach(node => {
      expect((Number(node.getAttribute("x")) - 1) % heatmap.cell.width).toBe(0);
    });
  });

  it("uses the default colour ramp for cell fills", () => {
    const heatmap = started();
    const fills = $$("rect.cell").map(n => (n as SVGElement).style.fill);
    fills.forEach(fill => expect(heatmap.options.colors).toContain(fill));
    // Low and high values must not land on the same colour.
    expect(new Set(fills).size).toBeGreaterThan(1);
  });

  it("lets a customColorCallback override every cell fill", () => {
    const customColorCallback = jest.fn(() => "#123456");
    started({ customColorCallback });
    expect(customColorCallback).toHaveBeenCalled();
    $$("rect.cell").forEach(node =>
      expect((node as SVGElement).style.fill).toBe("#123456"),
    );
  });

  it("renders one row label per row, carrying the label text", () => {
    started();
    expect(texts("g.rowLabel > text").sort()).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("renders one column label per column, carrying the label text", () => {
    started();
    expect(texts("g.columnLabel > text").sort()).toEqual(["cA", "cB", "cC"]);
  });

  it("gives every row label a remove icon and a genus separator line", () => {
    started();
    expect($$("g.rowLabel image.removeIcon")).toHaveLength(3);
    expect($$("g.rowLabel line.genusBorder")).toHaveLength(3);
  });

  it("notifies the caller when the render pass finishes", () => {
    const onUpdateFinished = jest.fn();
    started({ onUpdateFinished });
    expect(onUpdateFinished).toHaveBeenCalledTimes(1);
  });

  it("renders dendrograms when clustering is on and none when it is off", () => {
    started({ clustering: true });
    expect($$("g.rowDendogram path").length).toBeGreaterThan(0);
    expect($$("g.columnDendogram path").length).toBeGreaterThan(0);

    document.body.innerHTML = "";
    started({ clustering: false });
    expect($$("g.rowDendogram path")).toHaveLength(0);
    expect($$("g.columnDendogram path")).toHaveLength(0);
  });
});

describe("Heatmap column metadata rendering", () => {
  const withMetadata = (options: $TSFixMe = {}) =>
    started({
      enableColumnMetadata: true,
      columnMetadata: METADATA_FIELDS,
      ...options,
    });

  it("renders a metadata row and one cell per column", () => {
    withMetadata();
    expect($$("g.columnMetadataCells.sample_type")).toHaveLength(1);
    expect($$("g.columnMetadataCells rect.columnMetadataCell")).toHaveLength(3);
  });

  it("falls back to colorNoValue for a column missing the metadata field", () => {
    const heatmap = withMetadata({ colorNoValue: "#eaeaea" });
    const fills = $$("g.columnMetadataCells rect.columnMetadataCell").map(
      n => (n as SVGElement).style.fill,
    );
    expect(fills).toContain("#eaeaea");
    // The two columns that do have a value get distinct assigned colours.
    const assigned = fills.filter(f => f !== "#eaeaea");
    expect(new Set(assigned).size).toBe(2);
    expect(Object.keys(heatmap.metadataColors.sample_type).sort()).toEqual([
      "blood",
      "stool",
    ]);
  });

  it("renders a metadata label per configured field", () => {
    withMetadata();
    expect(texts("g.columnMetadata text").join(" ")).toContain("Sample Type");
  });

  it("adds the metadata add-link only when a click handler is supplied", () => {
    withMetadata();
    expect($$("g.columnMetadata .columnMetadataAdd")).toHaveLength(0);

    document.body.innerHTML = "";
    const heatmap = withMetadata({ onAddColumnMetadataClick: jest.fn() });
    expect($$("g.columnMetadata .columnMetadataAdd").length).toBeGreaterThan(0);
    expect(heatmap.getAddMetadataTriggerRef()).not.toBeNull();
  });

  it("reports the legend for a field, adding Unknown when a column lacks it", () => {
    const heatmap = withMetadata();
    const legend = heatmap.getColumnMetadataLegend("sample_type");
    expect(Object.keys(legend).sort()).toEqual(["Unknown", "blood", "stool"]);
  });

  it("omits Unknown when every column has the field", () => {
    const data = baseData();
    data.columnLabels[2].metadata = { sample_type: "saliva" } as $TSFixMe;
    const heatmap = started(
      { enableColumnMetadata: true, columnMetadata: METADATA_FIELDS },
      data,
    );
    const legend = heatmap.getColumnMetadataLegend("sample_type");
    expect(Object.keys(legend).sort()).toEqual(["blood", "saliva", "stool"]);
  });

  it("re-renders the metadata rows when the field list changes", () => {
    const heatmap = withMetadata();
    heatmap.updateColumnMetadata([
      { value: "sample_type", label: "Sample Type" },
      { value: "water_control", label: "Water Control" },
    ]);
    expect($$("g.columnMetadataCells")).toHaveLength(2);
  });
});

describe("Heatmap optional link renderers", () => {
  it("renders the add-row link only when onAddRowClick is set", () => {
    started();
    expect($$("g.columnMetadata .columnMetadataAdd")).toHaveLength(0);

    document.body.innerHTML = "";
    started({ onAddRowClick: jest.fn() });
    expect($$(".columnMetadataAdd").length).toBeGreaterThan(0);
  });

  it("renders the pin-column link only when onPinColumnClick is set", () => {
    started();
    const withoutLink = $$("text").length;

    document.body.innerHTML = "";
    started({ onPinColumnClick: jest.fn() });
    expect($$("text").length).toBeGreaterThan(withoutLink);
  });
});

describe("Heatmap cell interaction handlers", () => {
  const firstCell = (heatmap: $TSFixMe) => heatmap.filteredCells[0];

  it("shows the hover box over the cell and reports the hover", () => {
    const onNodeHover = jest.fn();
    const heatmap = started({ onNodeHover, clustering: false });
    const cell = firstCell(heatmap);

    heatmap.handleCellMouseOver(cell);

    expect(heatmap.gCellHover.attr("visibility")).toBe("visible");
    expect(Number(heatmap.gCellHover.attr("x"))).toBe(
      heatmap.columnLabels[cell.columnIndex].pos * heatmap.cell.width,
    );
    expect(heatmap.rowLabels[cell.rowIndex].highlighted).toBe(true);
    expect(heatmap.columnLabels[cell.columnIndex].highlighted).toBe(true);
    expect(onNodeHover).toHaveBeenCalledWith(cell);
  });

  it("hides the hover box again and reports the hover-out", () => {
    const onNodeHoverOut = jest.fn();
    const heatmap = started({ onNodeHoverOut, clustering: false });
    const cell = firstCell(heatmap);

    heatmap.handleCellMouseOver(cell);
    heatmap.handleCellMouseLeave(cell);

    expect(heatmap.gCellHover.attr("visibility")).toBe("hidden");
    expect(heatmap.rowLabels[cell.rowIndex].highlighted).toBe(false);
    expect(heatmap.columnLabels[cell.columnIndex].highlighted).toBe(false);
    expect(onNodeHoverOut).toHaveBeenCalledWith(cell);
  });

  it("works without hover callbacks", () => {
    const heatmap = started();
    const cell = firstCell(heatmap);
    heatmap.handleCellMouseOver(cell);
    heatmap.handleCellMouseLeave(cell);
    expect(heatmap.gCellHover.attr("visibility")).toBe("hidden");
  });

  it("passes the cell and the d3 event to onCellClick", () => {
    const onCellClick = jest.fn();
    const heatmap = started({ onCellClick });
    const cell = firstCell(heatmap);
    (d3 as $TSFixMe).event = { type: "click" };

    heatmap.handleCellClick(cell);
    expect(onCellClick).toHaveBeenCalledWith(cell, { type: "click" });
  });

  it("does nothing on click when no handler is registered", () => {
    const heatmap = started();
    expect(() => heatmap.handleCellClick(firstCell(heatmap))).not.toThrow();
  });
});

describe("Heatmap highlight overlays", () => {
  it("brackets a highlighted column with two overlays", () => {
    const heatmap = started({ clustering: false });
    const column = heatmap.columnLabels.find((c: $TSFixMe) => c.pos === 1);

    heatmap.highlightRowOrColumn(column);

    expect(heatmap.overlays).toHaveLength(2);
    expect(Number(heatmap.overlays[0].attr("width"))).toBe(heatmap.cell.width);
    expect(Number(heatmap.overlays[1].attr("x"))).toBe(heatmap.cell.width * 2);
  });

  it("widens the bracket for a multi-cell dendrogram highlight", () => {
    const heatmap = started({ clustering: false });
    const column = heatmap.columnLabels.find((c: $TSFixMe) => c.pos === 0);

    heatmap.highlightRowOrColumn(column, 2);

    expect(Number(heatmap.overlays[0].attr("width"))).toBe(0);
    expect(Number(heatmap.overlays[1].attr("x"))).toBe(heatmap.cell.width * 2);
  });

  it("brackets a highlighted row with two overlays", () => {
    const heatmap = started({ clustering: false });
    const row = heatmap.rowLabels.find((r: $TSFixMe) => r.pos === 1);

    heatmap.highlightRowOrColumn(row);

    expect(heatmap.overlays).toHaveLength(2);
    expect(Number(heatmap.overlays[0].attr("height"))).toBe(
      heatmap.cell.height,
    );
    expect(Number(heatmap.overlays[1].attr("y"))).toBe(heatmap.cell.height * 2);
  });

  it("removes the overlay rects from the dom when cleared", () => {
    const heatmap = started({ clustering: false });
    const before = $$("g rect").length;
    heatmap.highlightRowOrColumn(
      heatmap.rowLabels.find((r: $TSFixMe) => r.pos === 0),
    );
    expect($$("g rect").length).toBe(before + 2);

    heatmap.clearOverlays();
    expect(heatmap.overlays).toHaveLength(0);
    expect($$("g rect").length).toBe(before);
  });

  it("debounces the clear when nothing is highlighted", () => {
    jest.useFakeTimers();
    try {
      const heatmap = started({ clustering: false });
      heatmap.highlightRowOrColumn(
        heatmap.rowLabels.find((r: $TSFixMe) => r.pos === 0),
      );
      expect(heatmap.overlays).toHaveLength(2);

      heatmap.highlightRowOrColumn(null);
      // Still there -- the clear is deferred.
      expect(heatmap.overlays).toHaveLength(2);

      jest.advanceTimersByTime(200);
      expect(heatmap.overlays).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("cancels a pending clear when a new highlight arrives first", () => {
    jest.useFakeTimers();
    try {
      const heatmap = started({ clustering: false });
      heatmap.highlightRowOrColumn(
        heatmap.rowLabels.find((r: $TSFixMe) => r.pos === 0),
      );
      heatmap.highlightRowOrColumn(null);
      heatmap.highlightRowOrColumn(
        heatmap.rowLabels.find((r: $TSFixMe) => r.pos === 1),
      );

      jest.advanceTimersByTime(200);
      // The second highlight survived the debounced clear.
      expect(heatmap.overlays).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("Heatmap label hover handlers", () => {
  it("highlights the hovered row and reports the row group", () => {
    const onRowGroupEnter = jest.fn();
    const heatmap = started({ onRowGroupEnter, clustering: false });
    const row = heatmap.filteredRowLabels[0];

    heatmap.handleRowLabelMouseEnter(row);

    expect(heatmap.overlays).toHaveLength(2);
    expect(onRowGroupEnter).toHaveBeenCalledTimes(1);
    expect(onRowGroupEnter.mock.calls[0][0]).toBe(row);
  });

  it("skips the row group callback while the rows are clustered", () => {
    const onRowGroupEnter = jest.fn();
    const heatmap = started({ onRowGroupEnter, clustering: true });
    heatmap.handleRowLabelMouseEnter(heatmap.filteredRowLabels[0]);
    expect(onRowGroupEnter).not.toHaveBeenCalled();
    // The overlays are still drawn -- only the grouping is skipped.
    expect(heatmap.overlays).toHaveLength(2);
  });

  it("reports the row group leaving when not clustered", () => {
    const onRowGroupLeave = jest.fn();
    const heatmap = started({ onRowGroupLeave, clustering: false });
    const row = heatmap.filteredRowLabels[0];
    heatmap.handleRowLabelMouseEnter(row);
    heatmap.handleRowLabelMouseLeave(row);
    expect(onRowGroupLeave).toHaveBeenCalledWith(row);
  });

  it("skips the leave callback while the rows are clustered", () => {
    const onRowGroupLeave = jest.fn();
    const heatmap = started({ onRowGroupLeave, clustering: true });
    heatmap.handleRowLabelMouseLeave(heatmap.filteredRowLabels[0]);
    expect(onRowGroupLeave).not.toHaveBeenCalled();
  });

  it("brackets the hovered column and clears on leave", () => {
    jest.useFakeTimers();
    try {
      const heatmap = started({ clustering: false });
      heatmap.handleColumnLabelMouseEnter(heatmap.columnLabels[0]);
      expect(heatmap.overlays).toHaveLength(2);

      heatmap.handleColumnLabelMouseLeave();
      jest.advanceTimersByTime(200);
      expect(heatmap.overlays).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("Heatmap.removeRow", () => {
  it("hides the row, tells the caller and re-renders without it", () => {
    const onRemoveRow = jest.fn();
    const heatmap = started({ onRemoveRow, clustering: false });
    expect($$("g.rowLabel")).toHaveLength(3);

    const row = heatmap.rowLabels.find((r: $TSFixMe) => r.label === "beta");
    heatmap.removeRow(row);

    expect(onRemoveRow).toHaveBeenCalledWith("beta");
    expect(row.hidden).toBe(true);
    expect(row.pos).toBeUndefined();
    expect(
      heatmap.filteredRowLabels.map((r: $TSFixMe) => r.label),
    ).not.toContain("beta");
    // Two rows worth of cells survive the filter (the removed row's rects are
    // still in the dom until d3's exit transition finishes).
    expect(heatmap.filteredCells).toHaveLength(6);
  });

  it("works without an onRemoveRow callback", () => {
    const heatmap = started({ clustering: false });
    const row = heatmap.rowLabels[0];
    heatmap.removeRow(row);
    expect(row.hidden).toBe(true);
  });
});

describe("Heatmap zoom and print caption", () => {
  it("resizes the svg by the zoom factor", () => {
    const heatmap = started();
    heatmap.updateZoom(2);
    expect(Number(heatmap.svg.attr("width"))).toBe(heatmap.width * 2);
    expect(Number(heatmap.svg.attr("height"))).toBe(heatmap.height * 2);
  });

  it("draws one caption line per entry and restores the height when hidden", () => {
    const heatmap = started({ printCaption: ["line one", "line two"] });
    heatmap.updateZoom(1);
    const baseHeight = Number(heatmap.svg.attr("height"));

    heatmap.showPrintCaption();
    expect(texts("text.caption")).toEqual(["line one", "line two"]);
    expect(Number(heatmap.svg.attr("height"))).toBeGreaterThan(baseHeight);

    heatmap.hidePrintCaption();
    expect($$("text.caption")).toHaveLength(0);
    expect(Number(heatmap.svg.attr("height"))).toBe(baseHeight);
  });

  it("draws no caption when the caption list is empty", () => {
    const heatmap = started();
    heatmap.updateZoom(1);
    const baseHeight = Number(heatmap.svg.attr("height"));
    heatmap.showPrintCaption();
    expect($$("text.caption")).toHaveLength(0);
    expect(Number(heatmap.svg.attr("height"))).toBe(baseHeight);
  });

  it("picks up a caption set after construction", () => {
    const heatmap = started();
    heatmap.updateZoom(1);
    heatmap.updatePrintCaption(["fresh caption"]);
    heatmap.showPrintCaption();
    expect(texts("text.caption")).toEqual(["fresh caption"]);
  });

  it("swaps the truncated column labels for their full print labels", () => {
    const heatmap = started();
    heatmap.expandColumnLabels();
    expect(texts("g.columnLabel > text").sort()).toEqual([
      "columnA",
      "columnB",
      "columnC",
    ]);
  });
});

describe("Heatmap downloads", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("expands the labels, saves an svg and restores the truncated labels", () => {
    const heatmap = started();
    heatmap.updateZoom(1);
    const toggleFullNames = jest.fn();

    heatmap.download(toggleFullNames);
    expect(mockAsSvg).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(mockAsSvg).toHaveBeenCalledTimes(1);
    expect(mockAsSvg.mock.calls[0][1]).toBe("heatmap.svg");
    expect(toggleFullNames).toHaveBeenCalledWith("truncated");
  });

  it("saves a png the same way", () => {
    const heatmap = started();
    heatmap.updateZoom(1);
    const toggleFullNames = jest.fn();

    heatmap.downloadAsPng(toggleFullNames);
    jest.advanceTimersByTime(100);

    expect(mockAsPng).toHaveBeenCalledTimes(1);
    expect(mockAsPng.mock.calls[0][1]).toBe("heatmap.png");
    expect(toggleFullNames).toHaveBeenCalledWith("truncated");
  });
});

describe("Heatmap panning and scrolling", () => {
  it("translates the main group and clamps to the margins", () => {
    const heatmap = started();
    heatmap.updateZoom(1);

    heatmap.pan(500, 500);
    // Panning right/down past the origin is clamped to the margins.
    expect(heatmap.g.attr("transform")).toBe(
      `translate(${heatmap.options.marginLeft},${heatmap.options.marginTop})`,
    );
  });

  it("scroll pans by the negated wheel deltas", () => {
    const heatmap = started();
    heatmap.updateZoom(1);
    const panSpy = jest.spyOn(heatmap, "pan");
    (d3 as $TSFixMe).event = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      deltaX: 0,
      deltaY: 0,
    };

    heatmap.scroll({ deltaX: 12, deltaY: 34 });

    expect(panSpy).toHaveBeenCalledWith(-12, -34);
    expect((d3 as $TSFixMe).event.preventDefault).toHaveBeenCalled();
    expect((d3 as $TSFixMe).event.stopPropagation).toHaveBeenCalled();
  });

  it("scroll falls back to the ambient d3 event", () => {
    const heatmap = started();
    heatmap.updateZoom(1);
    const panSpy = jest.spyOn(heatmap, "pan");
    (d3 as $TSFixMe).event = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      deltaX: 5,
      deltaY: 6,
    };

    heatmap.scroll();
    expect(panSpy).toHaveBeenCalledWith(-5, -6);
  });

  it("scrollToRow does nothing for an unknown label", () => {
    const heatmap = started();
    heatmap.updateZoom(1);
    const panSpy = jest.spyOn(heatmap, "pan");
    heatmap.scrollToRow("not-a-row");
    expect(panSpy).not.toHaveBeenCalled();
  });

  it("scrollToRow pans to the row and briefly highlights it", () => {
    jest.useFakeTimers();
    try {
      const heatmap = started({ clustering: false });
      heatmap.updateZoom(1);
      const panSpy = jest.spyOn(heatmap, "pan");

      heatmap.scrollToRow("alpha");

      expect(panSpy).toHaveBeenCalledTimes(1);
      expect(panSpy.mock.calls[0][0]).toBe(0);
      expect(heatmap.scrollToRowInProgess).toBe(true);
      expect(heatmap.overlays).toHaveLength(2);

      jest.advanceTimersByTime(3000);
      expect(heatmap.overlays).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("Heatmap cursor helpers", () => {
  it("reads the cursor location off the d3 event", () => {
    const heatmap = started();
    (d3 as $TSFixMe).event = { pageX: 42, pageY: 84 };
    expect(heatmap.getCursorLocation()).toEqual({ left: 42, top: 84 });
  });

  it("returns null when the cursor is outside the grid", () => {
    const heatmap = started();
    heatmap.gCells[0][0].getBoundingClientRect = () => ({
      left: 100,
      top: 100,
      width: 300,
      height: 300,
    });
    (d3 as $TSFixMe).event = { clientX: 10, clientY: 10 };
    expect(heatmap.getCellFromCursorLocation()).toBeNull();
  });

  it("maps a cursor position back onto its cell", () => {
    const heatmap = started({ clustering: false });
    heatmap.gCells[0][0].getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 300,
      height: 300,
    });
    // Middle of the grid -> the middle column / middle row position.
    (d3 as $TSFixMe).event = { clientX: 150, clientY: 150 };

    const cell = heatmap.getCellFromCursorLocation();
    expect(cell).toBeDefined();
    expect(heatmap.columnLabels[cell.columnIndex].pos).toBe(1);
    expect(heatmap.rowLabels[cell.rowIndex].pos).toBe(1);
  });
});

describe("Heatmap.updateData", () => {
  it("re-parses and re-renders from the replacement data", () => {
    const heatmap = started({ clustering: false });
    expect($$("g.rowLabel")).toHaveLength(3);

    heatmap.updateData({
      rowLabels: [{ label: "solo", genusName: "genusS", sortKey: 1 }],
      values: [[1, 2, 3]],
    });

    expect(texts("g.rowLabel > text")).toContain("solo");
    expect(heatmap.filteredRowLabels.map((r: $TSFixMe) => r.label)).toEqual([
      "solo",
    ]);
    // The rects of the replaced rows linger until d3's exit transition ends.
    expect(heatmap.filteredCells).toHaveLength(3);
  });
});

// Frontend coverage: app/assets/src/components/visualizations/heatmap/Heatmap.ts
//
// jest/Heatmap.test.ts covers the data pipeline and
// jest/heatmap-Heatmap-rendering.test.ts covers the render pass plus the
// handlers it can call directly. What neither reaches is the wiring in
// between: the listeners the class attaches to real DOM nodes with d3's
// `.on(...)`. Those bodies only run when an event is actually dispatched at
// the node d3 bound them to, so this file drives them from the DOM.
//
// Covered here:
//   * the space-bar + drag panning state machine (body keydown/keyup, svg
//     mousedown/mousemove/mouseup and drag()), each guard taken both ways;
//   * the background-grid listeners that produce tooltips over EMPTY cells --
//     the previousNullHover bookkeeping has three distinct states;
//   * row-label, column-label, pin-icon, metadata-label and metadata-cell
//     listeners, each with and without its optional callback;
//   * the dendrogram hover-target rects, which drive updateHighlights.
//
// The jsdom shims are the same three the rendering spec explains: the scss
// module is proxied so `cs.foo === "foo"`, svgsaver is stubbed, getBBox and
// d3.transform are stood in for. See that file for the reasoning.
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

import d3 from "d3";
import Heatmap from "../app/assets/src/components/visualizations/heatmap/Heatmap";

if (typeof (global as $TSFixMe).CSS === "undefined") {
  (global as $TSFixMe).CSS = {
    escape: (value: string) =>
      String(value).replace(/([^a-zA-Z0-9_-])/g, "\\$1"),
  };
}

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

const baseData = () => ({
  rowLabels: [
    { label: "beta", genusName: "genusB", sortKey: 2 },
    { label: "alpha", genusName: "genusA", sortKey: 1 },
    { label: "gamma", genusName: "genusB", sortKey: 2 },
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

const METADATA_FIELDS = [{ value: "sample_type", label: "Sample Type" }];

let container: HTMLElement;

const started = (options: $TSFixMe = {}, data: $TSFixMe = baseData()) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  const heatmap = new Heatmap(container as HTMLElement, data, options);
  heatmap.start();
  return heatmap;
};

const $$ = (selector: string) =>
  Array.from(container.querySelectorAll(selector));
const $1 = (selector: string) => {
  const node = container.querySelector(selector);
  if (!node) throw new Error(`no node matched ${selector}`);
  return node;
};

// d3 v3 binds its listeners directly on the node, so no bubbling is needed and
// suppressing it keeps a dispatch from tripping an unrelated ancestor handler.
const fire = (node: Element, type: string, init: MouseEventInit = {}) =>
  node.dispatchEvent(new MouseEvent(type, { bubbles: false, ...init }));

const key = (type: string, code: string) =>
  document.body.dispatchEvent(
    new KeyboardEvent(type, { code, bubbles: false }),
  );

afterEach(() => {
  document.body.innerHTML = "";
  (d3 as $TSFixMe).event = null;
});

describe("Heatmap space-bar panning", () => {
  it("ignores mouse drags until the space bar is held down", () => {
    const heatmap = started();
    heatmap.updateZoom(1);
    const svgNode = heatmap.svg[0][0] as Element;
    const panSpy = jest.spyOn(heatmap, "pan");

    fire(svgNode, "mousedown", { clientX: 10, clientY: 20 });
    // The button is down, but with no space bar the origin is never captured.
    expect(heatmap.mouseDown).toBe(true);
    expect(heatmap.mouseX).toBeUndefined();

    fire(svgNode, "mousemove", { clientX: 60, clientY: 80 });
    expect(panSpy).not.toHaveBeenCalled();
  });

  it("pans by the pointer delta while space is held, then stops on mouseup", () => {
    const heatmap = started();
    heatmap.updateZoom(1);
    const svgNode = heatmap.svg[0][0] as Element;
    const panSpy = jest.spyOn(heatmap, "pan");

    key("keydown", "Space");
    expect(heatmap.spacePressed).toBe(true);
    expect((svgNode as HTMLElement).style.cursor).toBe("move");

    fire(svgNode, "mousedown", { clientX: 10, clientY: 20 });
    expect(heatmap.mouseX).toBe(10);
    expect(heatmap.mouseY).toBe(20);

    fire(svgNode, "mousemove", { clientX: 30, clientY: 45 });
    expect(panSpy).toHaveBeenCalledWith(20, 25);
    // The origin advances so the next move is measured from here.
    expect(heatmap.mouseX).toBe(30);
    expect(heatmap.mouseY).toBe(45);

    fire(svgNode, "mouseup");
    expect(heatmap.mouseDown).toBe(false);
    panSpy.mockClear();
    fire(svgNode, "mousemove", { clientX: 90, clientY: 90 });
    expect(panSpy).not.toHaveBeenCalled();
  });

  it("only reacts to the space key, and releases the cursor on keyup", () => {
    const heatmap = started();
    const svgNode = heatmap.svg[0][0] as Element;

    key("keydown", "KeyA");
    expect(heatmap.spacePressed).toBeFalsy();

    key("keydown", "Space");
    key("keyup", "KeyA");
    expect(heatmap.spacePressed).toBe(true);

    key("keyup", "Space");
    expect(heatmap.spacePressed).toBe(false);
    expect((svgNode as HTMLElement).style.cursor).toBe("auto");
  });
});

describe("Heatmap background grid (empty cell) listeners", () => {
  const gridFor = (heatmap: $TSFixMe) => {
    heatmap.gCells[0][0].getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 300,
      height: 300,
    });
    return heatmap.bgGrid[0][0] as Element;
  };

  it("reports a hover for the empty cell under the cursor", () => {
    const onNodeHover = jest.fn();
    const heatmap = started({ clustering: false, onNodeHover });
    const grid = gridFor(heatmap);

    fire(grid, "mousemove", { clientX: 150, clientY: 150 });

    expect(onNodeHover).toHaveBeenCalledTimes(1);
    expect(heatmap.previousNullHover).not.toBeNull();
    expect(
      heatmap.columnLabels[heatmap.previousNullHover.columnIndex].pos,
    ).toBe(1);
  });

  it("does not re-fire while the cursor stays inside the same cell", () => {
    const onNodeHover = jest.fn();
    const heatmap = started({ clustering: false, onNodeHover });
    const grid = gridFor(heatmap);

    fire(grid, "mousemove", { clientX: 150, clientY: 150 });
    fire(grid, "mousemove", { clientX: 152, clientY: 151 });
    expect(onNodeHover).toHaveBeenCalledTimes(1);
  });

  it("swaps the hover over to a new cell, closing out the previous one", () => {
    const onNodeHover = jest.fn();
    const onNodeHoverOut = jest.fn();
    const heatmap = started({
      clustering: false,
      onNodeHover,
      onNodeHoverOut,
    });
    const grid = gridFor(heatmap);

    fire(grid, "mousemove", { clientX: 20, clientY: 20 });
    const first = heatmap.previousNullHover;
    fire(grid, "mousemove", { clientX: 250, clientY: 250 });

    expect(onNodeHoverOut).toHaveBeenCalledWith(first);
    expect(onNodeHover).toHaveBeenCalledTimes(2);
    expect(heatmap.previousNullHover).not.toEqual(first);
  });

  it("clears the pending hover when the cursor leaves the grid", () => {
    const onNodeHoverOut = jest.fn();
    const heatmap = started({ clustering: false, onNodeHoverOut });
    const grid = gridFor(heatmap);

    fire(grid, "mousemove", { clientX: 150, clientY: 150 });
    fire(grid, "mouseleave");
    expect(onNodeHoverOut).toHaveBeenCalled();
    expect(heatmap.previousNullHover).toBeNull();

    // A second leave with nothing hovered is a no-op.
    onNodeHoverOut.mockClear();
    fire(grid, "mouseleave");
    expect(onNodeHoverOut).not.toHaveBeenCalled();
  });

  it("clicks through to the cell under the cursor", () => {
    const onCellClick = jest.fn();
    const heatmap = started({ clustering: false, onCellClick });
    const grid = gridFor(heatmap);

    fire(grid, "click", { clientX: 150, clientY: 150 });
    expect(onCellClick).toHaveBeenCalledTimes(1);
    // The centre of the 3x3 grid resolves to the middle row/column.
    const clicked = onCellClick.mock.calls[0][0];
    expect(heatmap.columnLabels[clicked.columnIndex].pos).toBe(1);
    expect(heatmap.rowLabels[clicked.rowIndex].pos).toBe(1);
    // A click does not open a hover; that bookkeeping stays untouched.
    expect(heatmap.previousNullHover).toBeNull();
  });

  it("ignores clicks and moves that land before the grid origin", () => {
    const onCellClick = jest.fn();
    const onNodeHover = jest.fn();
    const heatmap = started({ clustering: false, onCellClick, onNodeHover });
    // Grid starts at 100,100 -- a cursor at 10,10 is above and left of it.
    heatmap.gCells[0][0].getBoundingClientRect = () => ({
      left: 100,
      top: 100,
      width: 300,
      height: 300,
    });
    const grid = heatmap.bgGrid[0][0] as Element;

    fire(grid, "click", { clientX: 10, clientY: 10 });
    fire(grid, "mousemove", { clientX: 10, clientY: 10 });

    expect(onCellClick).not.toHaveBeenCalled();
    expect(onNodeHover).not.toHaveBeenCalled();
    expect(heatmap.previousNullHover).toBeFalsy();
  });
});

describe("Heatmap row label listeners", () => {
  it("reports a row label click with the label and the event", () => {
    const onRowLabelClick = jest.fn();
    const heatmap = started({ clustering: false, onRowLabelClick });
    const label = $1("g.rowLabel text");

    fire(label, "click");

    expect(onRowLabelClick).toHaveBeenCalledTimes(1);
    expect(onRowLabelClick.mock.calls[0][0]).toBe(
      heatmap.filteredRowLabels[0].label,
    );
    expect(onRowLabelClick.mock.calls[0][1]).toBeInstanceOf(MouseEvent);
  });

  it("swallows a row label click when no handler is registered", () => {
    started({ clustering: false });
    expect(() => fire($1("g.rowLabel text"), "click")).not.toThrow();
  });
});

describe("Heatmap column label and pin icon listeners", () => {
  it("reports hover, leave and click on a column label", () => {
    const onColumnLabelHover = jest.fn();
    const onColumnLabelOut = jest.fn();
    const onColumnLabelClick = jest.fn();
    started({
      clustering: false,
      onColumnLabelHover,
      onColumnLabelOut,
      onColumnLabelClick,
    });
    const label = $1("g.columnLabel text");

    fire(label, "mouseover");
    expect(onColumnLabelHover).toHaveBeenCalledTimes(1);
    expect(onColumnLabelHover.mock.calls[0][0].label).toBeDefined();

    fire(label, "mouseleave");
    expect(onColumnLabelOut).toHaveBeenCalledTimes(1);

    fire(label, "click");
    expect(onColumnLabelClick).toHaveBeenCalledTimes(1);
    // The click reports the column id, not the label object.
    expect([1, 2, 3]).toContain(onColumnLabelClick.mock.calls[0][0]);
  });

  it("swallows column label hover and click when no handlers are registered", () => {
    started({ clustering: false });
    const label = $1("g.columnLabel text");
    expect(() => {
      fire(label, "mouseover");
      fire(label, "click");
    }).not.toThrow();
  });

  it("shows the pin icon only for pinned columns and unpins on click", () => {
    const onUnpinColumn = jest.fn();
    const data = baseData();
    data.columnLabels[1].pinned = true;
    started(
      { clustering: false, onPinColumnClick: jest.fn(), onUnpinColumn },
      data,
    );

    const displays = $$("g.columnLabel image.pinIcon").map(n =>
      n.getAttribute("display"),
    );
    expect(displays).toContain("default");
    expect(displays).toContain("none");
    expect(displays.filter(d => d === "default")).toHaveLength(1);

    const pinned = $$("g.columnLabel image.pinIcon").find(
      n => n.getAttribute("display") === "default",
    ) as Element;
    fire(pinned, "click");
    expect(onUnpinColumn).toHaveBeenCalledWith(2);
  });

  it("reports pin icon hover and exit", () => {
    const onPinIconHover = jest.fn();
    const onPinIconExit = jest.fn();
    started({ clustering: false, onPinIconHover, onPinIconExit });
    const icon = $1("g.columnLabel image.pinIcon");

    fire(icon, "mouseenter");
    fire(icon, "mouseleave");
    expect(onPinIconHover).toHaveBeenCalledTimes(1);
    expect(onPinIconExit).toHaveBeenCalledTimes(1);
  });

  it("does not throw when a pin icon is clicked with no unpin handler", () => {
    started({ clustering: false });
    expect(() =>
      fire($1("g.columnLabel image.pinIcon"), "click"),
    ).not.toThrow();
  });
});

describe("Heatmap column metadata listeners", () => {
  const withMetadata = (options: $TSFixMe = {}, data: $TSFixMe = baseData()) =>
    started(
      {
        clustering: false,
        enableColumnMetadata: true,
        columnMetadata: METADATA_FIELDS,
        ...options,
      },
      data,
    );

  it("prefers the caller's metadata label click handler over the built-in sort", () => {
    const onColumnMetadataLabelClick = jest.fn();
    const heatmap = withMetadata({ onColumnMetadataLabelClick });

    fire($1("g.columnMetadataLabel text"), "click");

    expect(onColumnMetadataLabelClick).toHaveBeenCalledTimes(1);
    expect(onColumnMetadataLabelClick.mock.calls[0][0]).toBe("sample_type");
    // The internal sort state is untouched when the caller takes over.
    expect(heatmap.columnMetadataSortField).toBeUndefined();
  });

  it("falls back to the built-in sort when no click handler is supplied", () => {
    const heatmap = withMetadata();

    fire($1("g.columnMetadataLabel text"), "click");
    expect(heatmap.columnMetadataSortField).toBe("sample_type");
    expect(heatmap.columnMetadataSortAsc).toBe(true);

    fire($1("g.columnMetadataLabel text"), "click");
    expect(heatmap.columnMetadataSortAsc).toBe(false);
  });

  it("reports metadata label hover and leave", () => {
    const onColumnMetadataLabelHover = jest.fn();
    const onColumnMetadataLabelOut = jest.fn();
    withMetadata({ onColumnMetadataLabelHover, onColumnMetadataLabelOut });
    const label = $1("g.columnMetadataLabel text");

    fire(label, "mouseover");
    fire(label, "mouseleave");

    expect(onColumnMetadataLabelHover).toHaveBeenCalledTimes(1);
    expect(onColumnMetadataLabelHover.mock.calls[0][0].value).toBe(
      "sample_type",
    );
    expect(onColumnMetadataLabelOut).toHaveBeenCalledTimes(1);
  });

  it("swallows metadata label hover and leave when no handlers are registered", () => {
    withMetadata();
    const label = $1("g.columnMetadataLabel text");
    expect(() => {
      fire(label, "mouseover");
      fire(label, "mouseleave");
    }).not.toThrow();
  });

  it("reports a metadata cell hover with both the column and the field", () => {
    const onMetadataNodeHover = jest.fn();
    const onColumnMetadataLabelOut = jest.fn();
    withMetadata({ onMetadataNodeHover, onColumnMetadataLabelOut });
    const cell = $1("g.columnMetadataCells rect.columnMetadataCell");

    fire(cell, "mouseover");
    expect(onMetadataNodeHover).toHaveBeenCalledTimes(1);
    expect(onMetadataNodeHover.mock.calls[0][1]).toEqual(METADATA_FIELDS[0]);

    fire(cell, "mouseleave");
    expect(onColumnMetadataLabelOut).toHaveBeenCalledTimes(1);
  });

  it("swallows metadata cell hover and leave when no handlers are registered", () => {
    withMetadata();
    const cell = $1("g.columnMetadataCells rect.columnMetadataCell");
    expect(() => {
      fire(cell, "mouseover");
      fire(cell, "mouseleave");
    }).not.toThrow();
  });
});

describe("Heatmap dendrogram hover targets", () => {
  it("highlights the hovered branch and its rows, then clears on mouseout", () => {
    const heatmap = started({ clustering: true });
    const targets = $$("g.link rect.hoverTarget");
    expect(targets.length).toBeGreaterThan(0);

    fire(targets[0], "mouseover");
    // Hovering a branch brackets the rows it spans with overlay rects.
    expect(heatmap.overlays.length).toBeGreaterThan(0);
    expect($$("g.link.highlighted").length).toBeGreaterThan(0);

    fire(targets[0], "mouseout");
    expect($$("g.link.highlighted")).toHaveLength(0);
  });
});

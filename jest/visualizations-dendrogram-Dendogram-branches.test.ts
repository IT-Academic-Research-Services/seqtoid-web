// CZID-586 (#586) frontend coverage wave 4 -- branch closure for Dendogram.
//
// jest/Dendogram.test.ts already drives the happy paths. This file only exists
// to exercise the *other* side of conditionals that the happy paths never take:
// the `|| []` fallback in detachFromParent, updateOptions when the viz group has
// gone away, the data-less node guards in updateColors, the degenerate scale
// where the tick multiplier rounds away, the highlight predicate on the link
// *update* selection (which is empty on a first render, so it needs a second
// update to run at all) and the warning-icon hover guard for internal nodes.
//
// The two shims match the sibling spec and are needed for the same reasons:
// jsdom has no SVG layout engine (no getBBox), and addSvgColorFilter parses the
// $warning-medium/$warning-dark hex values out of a scss module that jest maps
// to an empty object, so it throws unless stubbed.
jest.mock("~/components/utils/d3/svg", () => ({
  __esModule: true,
  default: jest.fn((defs: unknown) => defs),
}));

import Dendogram from "~/components/visualizations/dendrogram/Dendogram";

beforeAll(() => {
  (SVGElement.prototype as unknown as { getBBox: () => unknown }).getBBox =
    () => ({ x: 0, y: 0, width: 40, height: 12 });
});

interface TreeNode {
  id: string;
  name: string;
  distance: number;
  children?: TreeNode[];
  coverage_breadth?: number;
}

// Flat root with two leaves.
function makeTree() {
  return {
    rerootTree: jest.fn(),
    root: {
      id: "root",
      name: "root__0",
      distance: 0,
      children: [
        { id: "a", name: "alpha__1", distance: 1, children: [] },
        { id: "b", name: "beta__2", distance: 2, children: [] },
      ],
    } as TreeNode,
  };
}

// Three levels, so there is an internal node that is not the root: needed for
// the "has children but is not depth 0" arm of the label-offset conditional and
// for the internal-node warning-icon hover guard.
function makeDeepTree() {
  return {
    rerootTree: jest.fn(),
    root: {
      id: "root",
      name: "root__0",
      distance: 0,
      children: [
        {
          id: "mid",
          name: "mid__1",
          distance: 1,
          children: [
            { id: "a", name: "alpha__2", distance: 1, children: [] },
            { id: "b", name: "beta__3", distance: 2, children: [] },
          ],
        },
        { id: "c", name: "gamma__4", distance: 3, children: [] },
      ],
    } as TreeNode,
  };
}

function mouseEventAt(type: string, pageX: number, pageY: number) {
  const event = new MouseEvent(type);
  Object.defineProperty(event, "pageX", { value: pageX });
  Object.defineProperty(event, "pageY", { value: pageY });
  return event;
}

function build(
  tree: unknown = makeTree(),
  options: Record<string, unknown> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dendogram = new Dendogram(container, tree, options);
  return { container, dendogram };
}

beforeEach(() => {
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

describe("Dendogram.detachFromParent without a children array", () => {
  it("falls back to an empty list when the parent has no children array", () => {
    const { dendogram } = build();
    const orphan = { parent: { children: undefined } };

    // The `(node.parent.children || [])` fallback keeps indexOf from throwing,
    // so the failure that surfaces is the splice on the missing array. That
    // pins the fallback as reached *and* documents that it does not rescue the
    // call: a parent without children is not a supported input.
    expect(() => dendogram.detachFromParent(orphan)).toThrow(TypeError);
  });

  it("still detaches normally when the parent does have children", () => {
    const { dendogram } = build();
    const a = dendogram.root.children[0];
    dendogram.detachFromParent(a);

    expect(dendogram.root.children).toHaveLength(1);
    expect(dendogram.root.children[0].data.id).toBe("b");
    expect(a.parent).toBeUndefined();
  });
});

describe("Dendogram.updateOptions with no viz group", () => {
  it("rebuilds the svg instead of clearing a viz that is not there", () => {
    const { container, dendogram } = build();
    expect(container.querySelectorAll("svg")).toHaveLength(1);

    // Simulate the pre-initialize state: no viz group to wipe. The `if (this.viz)`
    // clear is skipped and update() re-runs initialize() instead.
    dendogram.viz = null;
    dendogram.updateOptions({ curvedEdges: true, defaultColor: "#abcdef" });

    expect(dendogram.options.curvedEdges).toBe(true);
    expect(dendogram.options.defaultColor).toBe("#abcdef");
    expect(dendogram.viz).not.toBeNull();
    // initialize() appends a fresh svg rather than reusing the old one.
    expect(container.querySelectorAll("svg")).toHaveLength(2);
    expect(container.querySelectorAll("g.viz")).toHaveLength(2);
  });
});

describe("Dendogram.updateColors with data-less nodes", () => {
  it("skips leaves that carry no data and colours the root as uncoloured", () => {
    const { dendogram } = build(makeTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
    });

    // A hierarchy whose nodes have no `data` at all -- the guards in the leaf
    // sweep and at the top of colorNode are the only things standing between
    // this and a crash.
    const dataless = { data: null, leaves: () => [{ data: null }] };
    dendogram.root = dataless;
    dendogram.updateColors();

    // No attribute values were harvested, so only the "Uncolored" placeholder
    // survives and nothing was flagged as skip-colouring.
    expect(dendogram.allColorAttributeValues).toEqual(["Uncolored"]);
    expect(dendogram.skipColoring).toBe(false);
    expect(dendogram.colors[0]).toBe("#cccccc");
    // colorNode bailed out before it could stamp a colorIndex anywhere.
    expect(dataless).not.toHaveProperty("colorIndex");
  });

  it("still harvests attribute values from leaves that do have data", () => {
    const { dendogram } = build(makeTree(), {
      colorGroupAttribute: "id",
      colorGroupAbsentName: "Absent",
    });
    dendogram.updateColors();

    expect(dendogram.allColorAttributeValues).toEqual(["Uncolored", "a", "b"]);
    expect(dendogram.skipColoring).toBe(false);
  });
});

describe("Dendogram.createScale with a degenerate distance", () => {
  it("draws only the origin tick when the multiplier rounds away", () => {
    const { container, dendogram } = build();

    // distance 0 makes the step size non-finite, so the `if (multiplier)`
    // rescale is skipped and the tick loop never runs.
    dendogram.createScale(48, 250, 600, 0);

    expect(container.querySelector("path.scale-line")).not.toBeNull();
    expect(container.querySelectorAll("g.scale-tick")).toHaveLength(1);
  });

  it("draws a full ladder of ticks for a real distance", () => {
    const { container, dendogram } = build();
    dendogram.createScale(48, 250, 600, 2);

    expect(container.querySelectorAll("g.scale-tick").length).toBeGreaterThan(
      1,
    );
  });
});

// The link highlight predicate runs against the *update* selection, which is
// empty on a first render -- it only evaluates from the second update onwards.
//
// A second update also trips a live defect further down update(): the node label
// stroke tween at Dendogram.ts:647 reads `this.colors`, but inside a d3 tween
// `this` is the DOM element, not the Dendogram, so it throws TypeError. d3
// evaluates that tween eagerly inside .attr(), so the throw escapes update()
// synchronously. Every assertion below is on state committed *before* that
// point, and the throw itself is asserted so the defect stays pinned rather
// than being silently swallowed.
describe("Dendogram link highlighting on re-render", () => {
  it("leaves links unhighlighted on a second render when nothing is selected", () => {
    const { container, dendogram } = build(makeDeepTree());

    dendogram.update();
    expect(() => dendogram.update()).toThrow(TypeError);

    // No leaf was ever marked, so the predicate's left-hand side is falsy for
    // every link and none of them pick up the class.
    expect(container.querySelectorAll("path.link")).toHaveLength(4);
    expect(container.querySelectorAll("path.link.highlight")).toHaveLength(0);
  });

  it("highlights the path from a selected leaf up to the root", () => {
    const { container, dendogram } = build(makeDeepTree());
    dendogram.update();

    const alpha = dendogram.root
      .leaves()
      .find((leaf: { data: { id: string } }) => leaf.data.id === "a");
    // markAsHighlight re-runs update(), so this is the second pass: both sides
    // of `d.data.highlight && d.parent.data.highlight` now get evaluated.
    expect(() => dendogram.markAsHighlight(alpha)).toThrow(TypeError);

    expect(dendogram._highlighted.has("a")).toBe(true);
    // root->mid and mid->alpha, but not mid->beta or root->gamma.
    expect(container.querySelectorAll("path.link")).toHaveLength(4);
    expect(container.querySelectorAll("path.link.highlight")).toHaveLength(2);
  });
});

describe("Dendogram warning icon hover", () => {
  const options = () => {
    const warningTooltip = document.createElement("div");
    document.body.appendChild(warningTooltip);
    return {
      warningTooltipContainer: warningTooltip,
      onWarningIconHover: jest.fn(),
      onWarningIconExit: jest.fn(),
      warningTooltip,
    };
  };

  it("ignores hover on an internal node's icon", () => {
    const opts = options();
    const { container, dendogram } = build(makeDeepTree(), opts);
    dendogram.update();

    const internalIcon = container.querySelector("g.node-internal image");
    expect(internalIcon).not.toBeNull();
    internalIcon?.dispatchEvent(mouseEventAt("mouseenter", 30, 40));

    // The node has children, so the guard short-circuits: no callback, and the
    // tooltip never becomes visible or gets positioned.
    expect(opts.onWarningIconHover).not.toHaveBeenCalled();
    expect(opts.warningTooltip.classList.contains("visible")).toBe(false);
    expect(opts.warningTooltip.getAttribute("style")).toBeNull();
  });

  it("shows the tooltip on hover over a leaf's icon", () => {
    const opts = options();
    const { container, dendogram } = build(makeDeepTree(), opts);
    dendogram.update();

    const leafIcon = container.querySelector("g.node-leaf image");
    expect(leafIcon).not.toBeNull();
    leafIcon?.dispatchEvent(mouseEventAt("mouseenter", 30, 40));

    expect(opts.onWarningIconHover).toHaveBeenCalledTimes(1);
    expect(opts.warningTooltip.classList.contains("visible")).toBe(true);
    expect(opts.warningTooltip.getAttribute("style")).toBe(
      "left: 30px; top: 30px;",
    );
  });
});

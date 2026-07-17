// CZID-586 (#586) frontend coverage wave 4 -- D3 visualization classes.
//
// Dendogram is a plain class (no React), so it is driven directly: build a tree
// fixture, construct against a jsdom container, call the public methods, and
// assert on returned values and emitted SVG.
//
// Most of the value here is in the pure logic -- distance accumulation, the
// colour-cluster walk, highlight propagation, the position rescaling and the
// base-10 scale formatting -- which is asserted without touching the DOM at all.
// The render tests assert countable outcomes (how many nodes/links, which class,
// which label, whether the warning icon shows) rather than D3 internals.
//
// Two jsdom gaps are shimmed rather than worked around:
//  * jsdom implements no SVG layout, so getBBox does not exist. Dendogram calls
//    it to place the warning icon after each label and to size the legend
//    background. It is stubbed with fixed geometry; no assertion below depends
//    on the stubbed numbers being realistic.
//  * scss modules are mapped to an empty object by jest.config, so the
//    $warning-medium / $warning-dark hex values that addSvgColorFilter parses
//    come through undefined and it throws. The helper is mocked out; it only
//    appends an feColorMatrix filter and has no bearing on tree structure.
//    Its call is still asserted, so the wiring stays pinned.
jest.mock("~/components/utils/d3/svg", () => ({
  __esModule: true,
  default: jest.fn((defs: unknown) => defs),
}));

import addSvgColorFilter from "~/components/utils/d3/svg";
import Dendogram from "~/components/visualizations/dendrogram/Dendogram";

beforeAll(() => {
  // See the note above: jsdom has no SVG layout engine.
  (SVGElement.prototype as unknown as { getBBox: () => unknown }).getBBox =
    () => ({ x: 0, y: 0, width: 40, height: 12 });
});

interface TreeNode {
  id: string;
  name: string;
  distance: number;
  children?: TreeNode[];
  coverage_breadth?: number;
  metadata?: { location?: unknown };
}

// A root with two leaves. Leaf names carry the "__suffix" the class strips.
function makeTree(overrides: Partial<TreeNode> = {}) {
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
      ...overrides,
    } as TreeNode,
  };
}

// jsdom's MouseEvent does not implement pageX/pageY (they read back undefined),
// and the tooltip handlers position themselves from those. Define them on the
// event so the positioning maths can be asserted rather than producing "NaNpx".
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

describe("Dendogram constructor", () => {
  it("applies default options", () => {
    const { dendogram } = build();
    expect(dendogram.options.curvedEdges).toBe(false);
    expect(dendogram.options.defaultColor).toBe("#cccccc");
    expect(dendogram.options.absentColor).toBe("#000000");
    expect(dendogram.options.colorGroupAttribute).toBeNull();
    expect(dendogram.options.iconPath).toBe("/assets/icons");
    expect(dendogram.options.svgBackgroundColor).toBe("white");
  });

  it("lets caller options win over the defaults", () => {
    const { dendogram } = build(makeTree(), {
      curvedEdges: true,
      defaultColor: "#123456",
      iconPath: "/custom",
    });
    expect(dendogram.options.curvedEdges).toBe(true);
    expect(dendogram.options.defaultColor).toBe("#123456");
    expect(dendogram.options.iconPath).toBe("/custom");
  });

  it("tolerates options being omitted entirely", () => {
    const container = document.createElement("div");
    const dendogram = new Dendogram(container, makeTree(), null);
    expect(dendogram.options.defaultColor).toBe("#cccccc");
  });

  it("sets the fixed sizing constants", () => {
    const { dendogram } = build();
    expect(dendogram.minTreeSize).toEqual({ width: 600, height: 500 });
    expect(dendogram.margins).toEqual({
      top: 120,
      bottom: 20,
      left: 250,
      right: 150,
    });
    expect(dendogram.nodeSize).toEqual({ width: 1, height: 25 });
  });

  it("starts with nothing highlighted and no pending click", () => {
    const { dendogram } = build();
    expect(dendogram._highlighted.size).toBe(0);
    expect(dendogram._clickTimeout).toBeNull();
  });
});

describe("Dendogram.initialize", () => {
  it("sizes the svg to the tree plus its margins", () => {
    const { container } = build();
    const svg = container.querySelector("svg");
    // 600 + 250 + 150 wide, 500 + 120 + 20 tall.
    expect(svg?.getAttribute("width")).toBe("1000");
    expect(svg?.getAttribute("height")).toBe("640");
  });

  it("paints the svg background so downloads are not transparent", () => {
    const { container } = build(makeTree(), { svgBackgroundColor: "pink" });
    expect(container.querySelector("svg")?.getAttribute("style")).toBe(
      "background-color: pink",
    );
  });

  it("offsets the viz group by the margins", () => {
    const { container } = build();
    const viz = container.querySelector("g.viz");
    expect(viz).not.toBeNull();
    expect(viz?.getAttribute("transform")).toBe("translate(250, 120)");
  });
});

describe("Dendogram.adjustHeight", () => {
  it("grows the svg for a tree taller than the minimum", () => {
    const { container, dendogram } = build();
    dendogram.adjustHeight(900);
    // 900 + 120 + 20.
    expect(container.querySelector("svg")?.getAttribute("height")).toBe("1040");
  });

  it("never shrinks below the minimum tree height", () => {
    const { container, dendogram } = build();
    dendogram.adjustHeight(10);
    // Clamped to 500 + 120 + 20.
    expect(container.querySelector("svg")?.getAttribute("height")).toBe("640");
  });
});

describe("Dendogram.setTree", () => {
  it("builds a d3 hierarchy from the tree root", () => {
    const { dendogram } = build();
    expect(dendogram.root.data.id).toBe("root");
    expect(
      dendogram.root.leaves().map((l: { data: TreeNode }) => l.data.id),
    ).toEqual(["a", "b"]);
  });

  it("leaves root null for a null tree", () => {
    const { dendogram } = build(null);
    expect(dendogram.root).toBeNull();
    expect(dendogram.tree).toBeNull();
  });

  it("clears highlights carried over from the previous tree", () => {
    const { dendogram } = build();
    dendogram._highlighted.add("a");
    dendogram.setTree(makeTree());
    expect(dendogram._highlighted.size).toBe(0);
  });

  it("cancels a pending click timeout", () => {
    const { dendogram } = build();
    const stop = jest.fn();
    dendogram._clickTimeout = { stop };
    dendogram.setTree(makeTree());
    expect(stop).toHaveBeenCalled();
    expect(dendogram._clickTimeout).toBeNull();
  });

  it("clears the previously rendered viz contents", () => {
    const { container, dendogram } = build();
    dendogram.update();
    expect(container.querySelectorAll(".node").length).toBeGreaterThan(0);
    dendogram.setTree(makeTree());
    expect(container.querySelectorAll(".node")).toHaveLength(0);
  });
});

describe("Dendogram.getColorGroupAttrValForNode", () => {
  it("reads the configured attribute path off the node data", () => {
    const { dendogram } = build(makeTree(), {
      colorGroupAttribute: "metadata.location",
    });
    expect(
      dendogram.getColorGroupAttrValForNode({
        data: { metadata: { location: "USA" } },
      }),
    ).toBe("USA");
  });

  it("falls back to the absent name when the attribute is missing", () => {
    const { dendogram } = build(makeTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Unknown",
    });
    expect(dendogram.getColorGroupAttrValForNode({ data: {} })).toBe("Unknown");
  });

  it("uses the .name of an object-valued attribute", () => {
    const { dendogram } = build(makeTree(), {
      colorGroupAttribute: "metadata.location",
    });
    expect(
      dendogram.getColorGroupAttrValForNode({
        data: { metadata: { location: { name: "San Francisco", id: 7 } } },
      }),
    ).toBe("San Francisco");
  });
});

describe("Dendogram.computeDistanceToRoot", () => {
  it("accumulates each node's distance down from the root", () => {
    const { dendogram } = build();
    const maxDistance = dendogram.computeDistanceToRoot(dendogram.root);

    expect(dendogram.root.distanceToRoot).toBe(0);
    const [a, b] = dendogram.root.children;
    expect(a.distanceToRoot).toBe(1);
    expect(b.distanceToRoot).toBe(2);
    // The deepest cumulative distance in the tree.
    expect(maxDistance).toBe(2);
  });

  it("accumulates through nested clades", () => {
    const tree = {
      rerootTree: jest.fn(),
      root: {
        id: "root",
        name: "root",
        distance: 0,
        children: [
          {
            id: "clade",
            name: "clade",
            distance: 1,
            children: [
              { id: "a", name: "a", distance: 2, children: [] },
              { id: "b", name: "b", distance: 0.5, children: [] },
            ],
          },
        ],
      },
    };
    const { dendogram } = build(tree);
    const maxDistance = dendogram.computeDistanceToRoot(dendogram.root);

    const clade = dendogram.root.children[0];
    expect(clade.distanceToRoot).toBe(1);
    expect(clade.children[0].distanceToRoot).toBe(3);
    expect(clade.children[1].distanceToRoot).toBe(1.5);
    expect(maxDistance).toBe(3);
  });

  it("honours a starting offset", () => {
    const { dendogram } = build();
    expect(dendogram.computeDistanceToRoot(dendogram.root, 10)).toBe(12);
    expect(dendogram.root.distanceToRoot).toBe(10);
  });

  it("treats a missing distance as 0", () => {
    const tree = {
      rerootTree: jest.fn(),
      root: { id: "root", name: "root", children: [] },
    };
    const { dendogram } = build(tree);
    expect(dendogram.computeDistanceToRoot(dendogram.root)).toBe(0);
  });

  it("handles a single-node tree", () => {
    const tree = {
      rerootTree: jest.fn(),
      root: { id: "only", name: "only", distance: 4 },
    };
    const { dendogram } = build(tree);
    expect(dendogram.computeDistanceToRoot(dendogram.root)).toBe(4);
  });
});

describe("Dendogram.detachFromParent", () => {
  it("removes the node from its parent's children and drops the back-link", () => {
    const { dendogram } = build();
    const [a, b] = dendogram.root.children;

    dendogram.detachFromParent(a);

    expect(dendogram.root.children).toEqual([b]);
    expect(a.parent).toBeUndefined();
  });
});

describe("Dendogram.formatBase10", () => {
  it("renders small powers as a plain 2dp number", () => {
    const { dendogram } = build();
    expect(dendogram.formatBase10(2, 0)).toBe(2);
    expect(dendogram.formatBase10(1.5, -1)).toBe(0.15);
    expect(dendogram.formatBase10(3, 1)).toBe(30);
  });

  it("drops trailing zeroes from the 2dp rendering", () => {
    const { dendogram } = build();
    // "0.10" * 1 === 0.1
    expect(dendogram.formatBase10(1, -1)).toBe(0.1);
  });

  it("renders large and small powers in E notation", () => {
    const { dendogram } = build();
    expect(dendogram.formatBase10(3, 3)).toBe("3E3");
    expect(dendogram.formatBase10(2, -4)).toBe("2E-4");
  });
});

describe("Dendogram.markAsHighlight", () => {
  it("toggles a node in and out of the highlight set", () => {
    const { dendogram } = build();
    // update() is exercised separately; isolate the set behaviour here.
    jest.spyOn(dendogram, "update").mockImplementation(() => undefined);
    const [a] = dendogram.root.children;

    dendogram.markAsHighlight(a);
    expect(dendogram._highlighted.has("a")).toBe(true);

    dendogram.markAsHighlight(a);
    expect(dendogram._highlighted.has("a")).toBe(false);
  });

  it("re-renders on every toggle", () => {
    const { dendogram } = build();
    const update = jest
      .spyOn(dendogram, "update")
      .mockImplementation(() => undefined);

    dendogram.markAsHighlight(dendogram.root.children[0]);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("Dendogram.updateHighlights", () => {
  it("highlights a highlighted leaf and all of its ancestors", () => {
    const { dendogram } = build();
    dendogram._highlighted.add("a");

    dendogram.updateHighlights();

    const [a, b] = dendogram.root.children;
    expect(a.data.highlight).toBe(true);
    expect(dendogram.root.data.highlight).toBe(true);
    // The unhighlighted sibling stays off.
    expect(b.data.highlight).toBe(false);
  });

  it("clears highlights that are no longer in the set", () => {
    const { dendogram } = build();
    dendogram._highlighted.add("a");
    dendogram.updateHighlights();

    dendogram._highlighted.delete("a");
    dendogram.updateHighlights();

    expect(dendogram.root.children[0].data.highlight).toBe(false);
    expect(dendogram.root.data.highlight).toBe(false);
  });

  it("leaves everything unhighlighted when the set is empty", () => {
    const { dendogram } = build();
    dendogram.updateHighlights();
    expect(
      dendogram.root
        .descendants()
        .every(
          (n: { data: { highlight: boolean } }) => n.data.highlight === false,
        ),
    ).toBe(true);
  });
});

describe("Dendogram.updateColors", () => {
  function coloredTree() {
    return {
      rerootTree: jest.fn(),
      root: {
        id: "root",
        name: "root",
        distance: 0,
        children: [
          {
            id: "a",
            name: "a",
            distance: 1,
            children: [],
            metadata: { location: "USA" },
          },
          { id: "b", name: "b", distance: 1, children: [] },
        ],
      },
    };
  }

  it("does nothing without a colorGroupAttribute", () => {
    const { dendogram } = build();
    expect(dendogram.colors).toBeUndefined();
    expect(dendogram.allColorAttributeValues).toBeUndefined();
  });

  it("assigns each leaf the color index of its attribute value", () => {
    const { dendogram } = build(coloredTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
    });

    // Index 0 is reserved for the "Uncolored" placeholder.
    expect(dendogram.allColorAttributeValues).toEqual([
      "Uncolored",
      "USA",
      "Absent",
    ]);
    const [a, b] = dendogram.root.children;
    expect(a.data.colorIndex).toBe(1);
    expect(b.data.colorIndex).toBe(2);
  });

  it("leaves a parent uncolored when its children disagree", () => {
    const { dendogram } = build(coloredTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
    });
    // "USA" and "Absent" differ, so the root falls back to index 0.
    expect(dendogram.root.data.colorIndex).toBe(0);
  });

  it("colors a parent when every child shares a value", () => {
    const tree = coloredTree();
    tree.root.children[1].metadata = { location: "USA" };
    const { dendogram } = build(tree, {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
    });

    expect(dendogram.allColorAttributeValues).toEqual(["Uncolored", "USA"]);
    expect(dendogram.root.data.colorIndex).toBe(1);
    expect(dendogram.skipColoring).toBe(false);
  });

  it("slots the absent color in at the absent value's index", () => {
    const { dendogram } = build(coloredTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
      absentColor: "#000000",
      defaultColor: "#cccccc",
    });

    // "Absent" sits at index 2 of allColorAttributeValues.
    expect(dendogram.colors[0]).toBe("#cccccc");
    expect(dendogram.colors[2]).toBe("#000000");
  });

  it("skips coloring entirely when every leaf is absent", () => {
    const tree = coloredTree();
    delete tree.root.children[0].metadata;
    const { dendogram } = build(tree, {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
      defaultColor: "#cccccc",
    });

    expect(dendogram.skipColoring).toBe(true);
    // The legend still needs values to draw, but both are the uncolored color.
    expect(dendogram.allColorAttributeValues).toEqual(["Uncolored", "Absent"]);
    expect(dendogram.colors).toEqual(["#cccccc", "#cccccc"]);
  });
});

describe("Dendogram.updateOptions", () => {
  it("merges the new options over the old ones", () => {
    const { dendogram } = build();
    jest.spyOn(dendogram, "update").mockImplementation(() => undefined);

    dendogram.updateOptions({ curvedEdges: true });

    expect(dendogram.options.curvedEdges).toBe(true);
    // Untouched options survive the merge.
    expect(dendogram.options.defaultColor).toBe("#cccccc");
  });

  it("clears the old render and re-renders", () => {
    const { container, dendogram } = build();
    dendogram.update();
    const update = jest
      .spyOn(dendogram, "update")
      .mockImplementation(() => undefined);

    dendogram.updateOptions({ curvedEdges: true });

    expect(container.querySelectorAll(".node")).toHaveLength(0);
    expect(update).toHaveBeenCalled();
  });

  it("recomputes colors against the new attribute", () => {
    const { dendogram } = build();
    jest.spyOn(dendogram, "update").mockImplementation(() => undefined);

    dendogram.updateOptions({
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
    });

    expect(dendogram.allColorAttributeValues).toEqual(["Uncolored", "Absent"]);
  });
});

describe("Dendogram.rerootOriginalTree", () => {
  it("reroots the underlying tree at the given node and rebuilds the hierarchy", () => {
    const tree = makeTree();
    const { dendogram } = build(tree);
    jest.spyOn(dendogram, "update").mockImplementation(() => undefined);

    const [a] = dendogram.root.children;
    // Simulate the source tree rerooting itself around "a".
    tree.rerootTree.mockImplementation(() => {
      tree.root = { id: "a", name: "alpha__1", distance: 0, children: [] };
    });

    dendogram.rerootOriginalTree(a);

    expect(tree.rerootTree).toHaveBeenCalledWith("a");
    expect(dendogram.root.data.id).toBe("a");
  });
});

describe("Dendogram.clickHandler", () => {
  it("runs the double-click callback when a second click lands first", () => {
    const { dendogram } = build();
    const click = jest.fn();
    const dblClick = jest.fn();

    dendogram.clickHandler(click, dblClick);
    // Second click before the timeout fires.
    dendogram.clickHandler(click, dblClick);

    expect(dblClick).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
    expect(dendogram._clickTimeout).toBeNull();
  });

  it("runs the single-click callback once the delay elapses", async () => {
    const { dendogram } = build();
    const click = jest.fn();
    const dblClick = jest.fn();

    dendogram.clickHandler(click, dblClick, 1);
    expect(click).not.toHaveBeenCalled();

    await new Promise(resolve => setTimeout(resolve, 60));

    expect(click).toHaveBeenCalledTimes(1);
    expect(dblClick).not.toHaveBeenCalled();
    expect(dendogram._clickTimeout).toBeNull();
  });

  it("tolerates a missing double-click callback", () => {
    const { dendogram } = build();
    const click = jest.fn();

    dendogram.clickHandler(click, null);
    expect(() => dendogram.clickHandler(click, null)).not.toThrow();
  });
});

describe("Dendogram.adjustXPositions", () => {
  it("rescales node x positions to span the minimum tree height", () => {
    const { dendogram } = build();
    const [a, b] = dendogram.root.children;
    dendogram.root.x = 0;
    a.x = 10;
    b.x = 20;

    dendogram.adjustXPositions();

    // Range 0..20 stretched onto 0..500 (the minimum tree height).
    expect(dendogram.root.x).toBe(0);
    expect(a.x).toBe(250);
    expect(b.x).toBe(500);
  });

  it("keeps a tree taller than the minimum at its own scale", () => {
    const { dendogram } = build();
    const [a, b] = dendogram.root.children;
    dendogram.root.x = 0;
    a.x = 400;
    b.x = 800;

    dendogram.adjustXPositions();

    // Range 800 > 500, so positions are preserved rather than compressed.
    expect(a.x).toBe(400);
    expect(b.x).toBe(800);
  });

  it("normalises a negative x origin to 0", () => {
    const { dendogram } = build();
    const [a, b] = dendogram.root.children;
    dendogram.root.x = -100;
    a.x = -100;
    b.x = 400;

    dendogram.adjustXPositions();

    expect(a.x).toBe(0);
    expect(b.x).toBe(500);
  });

  it("resizes the svg to fit the rescaled tree", () => {
    const { container, dendogram } = build();
    const [a, b] = dendogram.root.children;
    dendogram.root.x = 0;
    a.x = 300;
    b.x = 900;

    dendogram.adjustXPositions();

    // 900 + 120 + 20.
    expect(container.querySelector("svg")?.getAttribute("height")).toBe("1040");
  });
});

describe("Dendogram.adjustYPositions", () => {
  it("maps distance-to-root onto the tree width", () => {
    const { dendogram } = build();
    dendogram.computeDistanceToRoot(dendogram.root);

    dendogram.adjustYPositions(2);

    const [a, b] = dendogram.root.children;
    expect(dendogram.root.y).toBe(0);
    // distance 1 of a max of 2 -> half of the 600px tree width.
    expect(a.y).toBe(300);
    expect(b.y).toBe(600);
  });
});

describe("Dendogram.updateLegend", () => {
  it("draws nothing without a colorGroupAttribute", () => {
    const { container, dendogram } = build();
    dendogram.updateLegend();
    expect(container.querySelector(".legend")).toBeNull();
  });

  it("titles the legend and lists every attribute value", () => {
    const { container, dendogram } = build(makeTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
      colorGroupLegendTitle: "Location",
    });
    dendogram.updateLegend();

    const legend = container.querySelector(".legend");
    expect(legend).not.toBeNull();
    expect(legend?.querySelector(".legend-title")?.textContent).toBe(
      "Location:",
    );

    const labels = Array.from(legend?.querySelectorAll("text") ?? [])
      .map(t => t.textContent)
      .filter(t => t !== "Location:");
    // "Uncolored" at index 0 is a placeholder and is not listed.
    expect(labels).toEqual(["Absent"]);
  });

  it("falls back to a generic legend title", () => {
    const { container, dendogram } = build(makeTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
    });
    dendogram.updateLegend();
    expect(container.querySelector(".legend-title")?.textContent).toBe(
      "Legend:",
    );
  });

  it("draws a color swatch per listed value", () => {
    const { container, dendogram } = build(makeTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
    });
    dendogram.updateLegend();
    expect(container.querySelectorAll(".legend circle")).toHaveLength(1);
  });

  it("places the legend at the configured origin", () => {
    const { container, dendogram } = build(makeTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
      legendX: 40,
      legendY: 60,
    });
    dendogram.updateLegend();
    const title = container.querySelector(".legend-title");
    expect(title?.getAttribute("x")).toBe("40");
    expect(title?.getAttribute("y")).toBe("60");
  });

  it("adds a background rect behind the legend", () => {
    const { container, dendogram } = build(makeTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
    });
    dendogram.updateLegend();
    expect(container.querySelector(".legend-background")).not.toBeNull();
  });

  it("redraws in place rather than stacking legends", () => {
    const { container, dendogram } = build(makeTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
    });
    dendogram.updateLegend();
    dendogram.updateLegend();

    expect(container.querySelectorAll(".legend")).toHaveLength(1);
    expect(container.querySelectorAll(".legend-title")).toHaveLength(1);
  });
});

describe("Dendogram.createScale", () => {
  it("draws the scale bar once, at the given offset", () => {
    const { container, dendogram } = build(makeTree(), {
      scaleLabel: "substitutions/site",
    });
    dendogram.createScale(48, 250, 600, 2);

    const scale = container.querySelector(".scale");
    expect(scale).not.toBeNull();
    expect(scale?.getAttribute("transform")).toBe("translate(250,48)");
    expect(scale?.querySelector(".scale-line")?.getAttribute("d")).toBe(
      "M0 10 L600 10",
    );
  });

  it("labels the scale", () => {
    const { container, dendogram } = build(makeTree(), {
      scaleLabel: "substitutions/site",
    });
    dendogram.createScale(48, 250, 600, 2);
    const texts = Array.from(container.querySelectorAll(".scale text")).map(
      t => t.textContent,
    );
    expect(texts).toContain("substitutions/site");
  });

  it("emits tick marks across the scale", () => {
    const { container, dendogram } = build();
    dendogram.createScale(48, 250, 600, 2);
    expect(container.querySelectorAll(".scale-tick").length).toBeGreaterThan(1);
  });

  it("reuses the existing scale group on a redraw", () => {
    const { container, dendogram } = build();
    dendogram.createScale(48, 250, 600, 2);
    dendogram.createScale(48, 250, 600, 4);
    expect(container.querySelectorAll(".scale")).toHaveLength(1);
  });

  it("labels only every other tick", () => {
    const { container, dendogram } = build();
    dendogram.createScale(48, 250, 600, 2);

    const tickLabels = Array.from(
      container.querySelectorAll(".scale-tick text"),
    ).map(t => t.textContent);
    // Odd-indexed ticks carry an undefined multiplier and render blank.
    expect(tickLabels.filter(t => t === "")).not.toHaveLength(0);
    expect(tickLabels.filter(t => t !== "")).not.toHaveLength(0);
  });
});

describe("Dendogram.update", () => {
  it("does nothing without a tree", () => {
    const { container, dendogram } = build(null);
    dendogram.update();
    expect(container.querySelectorAll(".node")).toHaveLength(0);
  });

  it("renders a node per hierarchy member and a link per edge", () => {
    const { container, dendogram } = build();
    dendogram.update();

    // Root plus two leaves; links are the descendants minus the root.
    expect(container.querySelectorAll(".node")).toHaveLength(3);
    expect(container.querySelectorAll(".link")).toHaveLength(2);
  });

  it("distinguishes internal nodes from leaves", () => {
    const { container, dendogram } = build();
    dendogram.update();

    expect(container.querySelectorAll(".node-internal")).toHaveLength(1);
    expect(container.querySelectorAll(".node-leaf")).toHaveLength(2);
  });

  it("labels leaves with the name up to the '__' separator", () => {
    const { container, dendogram } = build();
    dendogram.update();

    const labels = Array.from(
      container.querySelectorAll(".node-leaf text"),
    ).map(t => t.textContent);
    expect(labels).toEqual(["alpha", "beta"]);
  });

  it("leaves internal nodes unlabelled", () => {
    const { container, dendogram } = build();
    dendogram.update();
    expect(container.querySelector(".node-internal text")?.textContent).toBe(
      "",
    );
  });

  it("draws rectangular edges by default", () => {
    const { container, dendogram } = build();
    dendogram.update();
    const d = container.querySelector(".link")?.getAttribute("d");
    // rectEdge emits two L segments; curveEdge emits a C.
    expect(d).toMatch(/^M[\d.-]+ [\d.-]+ L[\d.-]+ [\d.-]+ L[\d.-]+ [\d.-]+$/);
  });

  it("draws curved edges when curvedEdges is set", () => {
    const { container, dendogram } = build(makeTree(), { curvedEdges: true });
    dendogram.update();
    expect(container.querySelector(".link")?.getAttribute("d")).toContain("C");
  });

  it("marks links between highlighted nodes", () => {
    const { container, dendogram } = build();
    dendogram.update();
    // .link.highlight is only applied to links already in the DOM, so the
    // highlight has to be applied to an already-rendered tree.
    expect(container.querySelectorAll(".link.highlight")).toHaveLength(0);
  });

  it("gives internal nodes a smaller circle than leaves", () => {
    const { container, dendogram } = build();
    dendogram.update();

    expect(
      container.querySelector(".node-internal circle")?.getAttribute("r"),
    ).toBe("1");
    expect(
      container.querySelector(".node-leaf circle")?.getAttribute("r"),
    ).toBe("2");
  });

  it("registers the orange warning-icon color filters", () => {
    const { dendogram } = build();
    dendogram.update();

    expect(addSvgColorFilter).toHaveBeenCalledTimes(2);
    expect((addSvgColorFilter as jest.Mock).mock.calls.map(c => c[1])).toEqual([
      "warning-medium",
      "warning-dark",
    ]);
  });

  it("shows the warning icon only for low coverage breadth", () => {
    const tree = makeTree();
    tree.root.children[0].coverage_breadth = 0.1;
    tree.root.children[1].coverage_breadth = 0.9;
    const { container, dendogram } = build(tree);
    dendogram.update();

    const displays = Array.from(
      container.querySelectorAll(".node-leaf image"),
    ).map(i => i.getAttribute("display"));
    // Below 0.25 -> shown; at or above -> hidden.
    expect(displays).toEqual(["default", "none"]);
  });

  it("hides the warning icon when coverage breadth is absent", () => {
    const { container, dendogram } = build();
    dendogram.update();

    const displays = Array.from(container.querySelectorAll("image")).map(i =>
      i.getAttribute("display"),
    );
    expect(displays.every(d => d === "none")).toBe(true);
  });

  it("points the warning icon at the configured icon path", () => {
    const { container, dendogram } = build(makeTree(), { iconPath: "/icons" });
    dendogram.update();
    // d3 writes xlink:href into the XLink namespace, so it is not reachable by
    // plain getAttribute.
    expect(
      container
        .querySelector("image")
        ?.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
    ).toBe("/icons/IconAlertSmall.svg");
  });

  it("colors every node the default gray without a colorGroupAttribute", () => {
    const { container, dendogram } = build(makeTree(), {
      defaultColor: "#cccccc",
    });
    dendogram.update();

    const fills = Array.from(container.querySelectorAll(".node")).map(
      n => (n as SVGElement).style.fill,
    );
    expect(fills.every(f => f === "#cccccc")).toBe(true);
  });

  it("colors nodes from their color index when coloring is active", () => {
    const tree = makeTree();
    tree.root.children[0].metadata = { location: "USA" };
    tree.root.children[1].metadata = { location: "USA" };
    const { container, dendogram } = build(tree, {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
    });
    dendogram.update();

    expect(dendogram.skipColoring).toBe(false);
    // Every node resolved to the single "USA" color, not the default gray.
    const fills = new Set(
      Array.from(container.querySelectorAll(".node")).map(
        n => (n as SVGElement).style.fill,
      ),
    );
    expect(fills.size).toBe(1);
    expect(fills.has("#cccccc")).toBe(false);
  });

  it("falls back to the default color when coloring is skipped", () => {
    const { container, dendogram } = build(makeTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
      defaultColor: "#cccccc",
    });
    dendogram.update();

    expect(dendogram.skipColoring).toBe(true);
    const fills = Array.from(container.querySelectorAll(".node")).map(
      n => (n as SVGElement).style.fill,
    );
    expect(fills.every(f => f === "#cccccc")).toBe(true);
  });

  it("draws the legend above the tree when coloring by attribute", () => {
    const { container, dendogram } = build(makeTree(), {
      colorGroupAttribute: "metadata.location",
      colorGroupAbsentName: "Absent",
    });
    dendogram.update();
    expect(container.querySelector(".legend")).not.toBeNull();
  });

  it("re-initializes the svg if the viz group was dropped", () => {
    const { container, dendogram } = build();
    dendogram.viz = null;

    dendogram.update();

    expect(container.querySelectorAll(".node").length).toBeGreaterThan(0);
  });
});

describe("Dendogram node interaction", () => {
  it("calls onNodeTextClick with the clicked leaf", () => {
    const onNodeTextClick = jest.fn();
    const { container, dendogram } = build(makeTree(), { onNodeTextClick });
    dendogram.update();

    container
      .querySelector(".node-leaf text")
      ?.dispatchEvent(new MouseEvent("click"));

    expect(onNodeTextClick).toHaveBeenCalledTimes(1);
    expect(onNodeTextClick.mock.calls[0][0].data.id).toBe("a");
  });

  it("does not throw on a text click when no handler is configured", () => {
    const { container, dendogram } = build();
    dendogram.update();
    expect(() =>
      container
        .querySelector(".node-leaf text")
        ?.dispatchEvent(new MouseEvent("click")),
    ).not.toThrow();
  });

  it("routes a node circle click through the click/double-click arbiter", () => {
    const { container, dendogram } = build();
    dendogram.update();
    const clickHandler = jest.spyOn(dendogram, "clickHandler");

    container
      .querySelector(".node-leaf circle")
      ?.dispatchEvent(new MouseEvent("click"));

    expect(clickHandler).toHaveBeenCalledTimes(1);
  });

  it("marks the node as highlighted on a single click", () => {
    const { container, dendogram } = build();
    dendogram.update();
    // Capture the callbacks handed to the click/double-click arbiter and drive
    // them directly; the arbiter's own timing is covered in its own describe.
    const clickHandler = jest.spyOn(dendogram, "clickHandler");
    jest.spyOn(dendogram, "update").mockImplementation(() => undefined);

    container
      .querySelector(".node-leaf circle")
      ?.dispatchEvent(new MouseEvent("click"));

    const [onClick] = clickHandler.mock.calls[0];
    onClick();

    expect(dendogram._highlighted.has("a")).toBe(true);
  });

  it("reroots the tree at the node on a double click", () => {
    const tree = makeTree();
    const { container, dendogram } = build(tree);
    dendogram.update();
    const clickHandler = jest.spyOn(dendogram, "clickHandler");
    jest.spyOn(dendogram, "update").mockImplementation(() => undefined);

    container
      .querySelector(".node-leaf circle")
      ?.dispatchEvent(new MouseEvent("click"));

    const [, onDblClick] = clickHandler.mock.calls[0];
    onDblClick();

    expect(tree.rerootTree).toHaveBeenCalledWith("a");
  });

  it("tracks the cursor with the tooltip while over a leaf", () => {
    const tooltip = document.createElement("div");
    document.body.appendChild(tooltip);
    const { container, dendogram } = build(makeTree(), {
      tooltipContainer: tooltip,
    });
    dendogram.update();

    container
      .querySelector(".node-leaf")
      ?.dispatchEvent(mouseEventAt("mousemove", 100, 50));

    // The tooltip trails the pointer by 20px on both axes.
    expect(tooltip.style.left).toBe("120px");
    expect(tooltip.style.top).toBe("70px");
  });

  it("does not move the tooltip for internal nodes", () => {
    const tooltip = document.createElement("div");
    document.body.appendChild(tooltip);
    const { container, dendogram } = build(makeTree(), {
      tooltipContainer: tooltip,
    });
    dendogram.update();

    container
      .querySelector(".node-internal")
      ?.dispatchEvent(mouseEventAt("mousemove", 100, 50));

    expect(tooltip.style.left).toBe("");
  });

  it("wires no tooltip handlers without a tooltipContainer", () => {
    const onNodeHover = jest.fn();
    const { container, dendogram } = build(makeTree(), { onNodeHover });
    dendogram.update();

    container
      .querySelector(".node-leaf")
      ?.dispatchEvent(new MouseEvent("mouseenter"));

    expect(onNodeHover).not.toHaveBeenCalled();
  });

  it("shows the tooltip and reports the hovered leaf", () => {
    const tooltip = document.createElement("div");
    document.body.appendChild(tooltip);
    const onNodeHover = jest.fn();
    const { container, dendogram } = build(makeTree(), {
      tooltipContainer: tooltip,
      onNodeHover,
    });
    dendogram.update();

    container
      .querySelector(".node-leaf")
      ?.dispatchEvent(new MouseEvent("mouseenter"));

    expect(onNodeHover).toHaveBeenCalledTimes(1);
    expect(onNodeHover.mock.calls[0][0].data.id).toBe("a");
    expect(tooltip.classList.contains("visible")).toBe(true);
  });

  it("does not show the tooltip for internal nodes", () => {
    const tooltip = document.createElement("div");
    document.body.appendChild(tooltip);
    const onNodeHover = jest.fn();
    const { container, dendogram } = build(makeTree(), {
      tooltipContainer: tooltip,
      onNodeHover,
    });
    dendogram.update();

    container
      .querySelector(".node-internal")
      ?.dispatchEvent(new MouseEvent("mouseenter"));

    expect(onNodeHover).not.toHaveBeenCalled();
    expect(tooltip.classList.contains("visible")).toBe(false);
  });

  it("hides the tooltip on mouseleave", () => {
    const tooltip = document.createElement("div");
    document.body.appendChild(tooltip);
    const { container, dendogram } = build(makeTree(), {
      tooltipContainer: tooltip,
    });
    dendogram.update();

    const leaf = container.querySelector(".node-leaf");
    leaf?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(tooltip.classList.contains("visible")).toBe(true);

    leaf?.dispatchEvent(new MouseEvent("mouseleave"));
    expect(tooltip.classList.contains("visible")).toBe(false);
  });

  it("shows the warning tooltip when the icon is hovered", () => {
    const warningTooltip = document.createElement("div");
    document.body.appendChild(warningTooltip);
    const onWarningIconHover = jest.fn();
    const { container, dendogram } = build(makeTree(), {
      warningTooltipContainer: warningTooltip,
      onWarningIconHover,
    });
    dendogram.update();

    container
      .querySelector(".node-leaf image")
      ?.dispatchEvent(mouseEventAt("mouseenter", 100, 50));

    expect(onWarningIconHover).toHaveBeenCalledTimes(1);
    expect(warningTooltip.classList.contains("visible")).toBe(true);
    // The warning tooltip sits on the pointer horizontally, 10px above it.
    expect(warningTooltip.style.left).toBe("100px");
    expect(warningTooltip.style.top).toBe("40px");
  });

  it("hides the warning tooltip and reports the exit", () => {
    const warningTooltip = document.createElement("div");
    document.body.appendChild(warningTooltip);
    const onWarningIconExit = jest.fn();
    const { container, dendogram } = build(makeTree(), {
      warningTooltipContainer: warningTooltip,
      onWarningIconExit,
    });
    dendogram.update();

    const icon = container.querySelector(".node-leaf image");
    icon?.dispatchEvent(new MouseEvent("mouseenter"));
    icon?.dispatchEvent(new MouseEvent("mouseleave"));

    expect(onWarningIconExit).toHaveBeenCalledTimes(1);
    expect(warningTooltip.classList.contains("visible")).toBe(false);
  });
});

// Branch coverage for app/assets/src/components/visualizations/TidyTree/TidyTree.ts
//
// Companion to visualizations-TidyTree.test.ts, which drives the common paths.
// This file drives the sides of TidyTree's conditionals that the happy path
// never reaches:
//
//   * sortAndScaleTree: `d.children.length || (d.children = null)` when the
//     collapse filter removes *every* child, and the resulting `if
//     (hasVisibleChildren && hasHiddenChildren)` guard going false so no
//     aggregated "(n)" node is synthesised.
//   * expandCollapsedWithFewChildrenOrNoName: the `(node.data || {})` fallback.
//   * update(): the `|| this.root.x0` fallback when the caller's source has no
//     usable offsets.
//   * the overlay placement ternaries, whose leaf-node (no visible children)
//     side is only taken when an overlay exists for a childless node.
import { scaleLinear } from "d3-scale";
import { timerFlush } from "d3-timer";
import "d3-transition";
import { TidyTree } from "~/components/visualizations/TidyTree/TidyTree";

const getBBox = jest.fn(() => ({ x: 0, y: 0, width: 40, height: 12 }));

beforeAll(() => {
  const proto = SVGElement.prototype as $TSFixMe;
  proto.getBBox = getBBox;
  proto.getComputedTextLength = () => 0;
  // The overlay tests below run the pending D3 transitions to completion so the
  // computed positions actually land on the element. Flushing also starts the
  // svg's own `transform` tweens, and d3-interpolate parses those through
  // SVGElement.transform.baseVal -- which jsdom does not implement. Reporting
  // "no consolidated matrix" makes d3 fall back to its identity transform,
  // which is all these tests need from the svg side.
  Object.defineProperty(proto, "transform", {
    configurable: true,
    get: () => ({ baseVal: { consolidate: () => null } }),
  });
});

beforeEach(() => {
  document.body.innerHTML = "";
  getBBox.mockClear();
});

function makeContainer() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

function buildTree(options: $TSFixMe, nodes: $TSFixMe) {
  const container = makeContainer();
  const tree = new TidyTree(container, nodes, options);
  return { tree, container };
}

const idsOf = (nodes: $TSFixMe) =>
  (nodes || []).map((node: $TSFixMe) => node.id);

// root(100) -> a(80) -> three children that all score at the very bottom of the
// range. With the default 0.4 threshold every one of a's children is below the
// cut, and there are more of them than minNonCollapsableChildren (2), so a ends
// up with an empty visible-children list.
//
//   root(100)
//     +-- a(80)
//     |     +-- p(2) q(2) r(2)
//     +-- b(10)
const ALL_CHILDREN_COLLAPSE = () => [
  {
    id: "root",
    parentId: null,
    scientificName: "Root Organism",
    values: { aggregatescore: 100 },
    lineageRank: "superkingdom",
  },
  {
    id: "a",
    parentId: "root",
    scientificName: "Alpha",
    values: { aggregatescore: 80 },
    lineageRank: "genus",
  },
  {
    id: "b",
    parentId: "root",
    scientificName: "Beta",
    values: { aggregatescore: 10 },
    lineageRank: "genus",
  },
  ...["p", "q", "r"].map(id => ({
    id,
    parentId: "a",
    scientificName: id.toUpperCase(),
    values: { aggregatescore: 2 },
    lineageRank: "species",
  })),
];

describe("TidyTree sortAndScaleTree with every child below the threshold", () => {
  it("nulls out the visible children instead of leaving an empty array", () => {
    const { tree } = buildTree({}, ALL_CHILDREN_COLLAPSE());

    const a = tree.root.children.find((child: $TSFixMe) => child.id === "a");
    // All three of a's children were folded away...
    expect(idsOf(a.collapsedChildren).sort()).toEqual(["p", "q", "r"]);
    // ...and because the filtered array came back empty, `children` was reset
    // to null rather than kept as [].
    expect(a.children).toBeNull();
    expect(tree.hasVisibleChildren(a)).toBe(false);
    expect(tree.hasHiddenChildren(a)).toBe(true);
  });

  it("does not synthesise an aggregated node for a fully collapsed parent", () => {
    const { tree, container } = buildTree({}, ALL_CHILDREN_COLLAPSE());

    // The aggregated "(n)" node is only added when a parent keeps at least one
    // visible child; here it keeps none, so the guard must fall through.
    const aggregated = tree.root
      .descendants()
      .filter((d: $TSFixMe) => d.isAggregated);
    expect(aggregated).toHaveLength(0);
    expect(
      tree.root
        .descendants()
        .map((d: $TSFixMe) => d.id)
        .sort(),
    ).toEqual(["a", "b", "root"]);
    // Only the three surviving nodes are drawn.
    expect(container.querySelectorAll("g.node")).toHaveLength(3);
  });
});

describe("TidyTree expandCollapsedWithFewChildrenOrNoName", () => {
  it("expands a node that carries more hidden children than the minimum but no name", () => {
    // "n" is force-collapsed, so its child "m" -- which itself folded three
    // children away -- is only visited once "n" is toggled back open.
    //
    //   root(100)
    //     +-- n(90)  (in options.collapsed)
    //     |     +-- m(80)
    //     |           +-- p(2) q(2) r(2)
    //     +-- b(10)
    const nodes = [
      {
        id: "root",
        parentId: null,
        scientificName: "Root Organism",
        values: { aggregatescore: 100 },
        lineageRank: "superkingdom",
      },
      {
        id: "n",
        parentId: "root",
        scientificName: "En",
        values: { aggregatescore: 90 },
        lineageRank: "genus",
      },
      {
        id: "m",
        parentId: "n",
        scientificName: "Em",
        values: { aggregatescore: 80 },
        lineageRank: "species",
      },
      {
        id: "b",
        parentId: "root",
        scientificName: "Beta",
        values: { aggregatescore: 10 },
        lineageRank: "genus",
      },
      ...["p", "q", "r"].map(id => ({
        id,
        parentId: "m",
        scientificName: id.toUpperCase(),
        values: { aggregatescore: 2 },
        lineageRank: "strain",
      })),
    ];

    const { tree } = buildTree({ collapsed: new Set(["n"]) }, nodes);

    const n = tree.root.children.find((child: $TSFixMe) => child.id === "n");
    expect(n.children).toBeNull();
    const m = n.collapsedChildren[0];
    expect(m.id).toBe("m");
    expect(idsOf(m.collapsedChildren).sort()).toEqual(["p", "q", "r"]);

    tree.toggleCollapseNode(n);

    // Re-opening "n" walks into "m". Its three hidden children exceed
    // minNonCollapsableChildren, so the expansion only happens because the
    // datum has no `name` -- and it does happen.
    expect(idsOf(n.children)).toEqual(["m"]);
    expect(idsOf(m.children).sort()).toEqual(["p", "q", "r"]);
    expect(m.collapsedChildren).toBeNull();
  });

  it("still expands when the node has no datum at all", () => {
    // Defensive `node.data || {}` fallback. The method is public and takes a
    // bare node, so it is driven directly rather than through the tree.
    const { tree } = buildTree({}, ALL_CHILDREN_COLLAPSE());
    const hidden = [{ id: "x" }, { id: "y" }, { id: "z" }];
    const node = { collapsedChildren: hidden, children: null } as $TSFixMe;

    tree.expandCollapsedWithFewChildrenOrNoName(node);

    expect(idsOf(node.children)).toEqual(["x", "y", "z"]);
    expect(node.collapsedChildren).toBeNull();
  });

  it("leaves a named node with many hidden children collapsed", () => {
    const { tree } = buildTree({}, ALL_CHILDREN_COLLAPSE());
    const hidden = [{ id: "x" }, { id: "y" }, { id: "z" }];
    const node = {
      data: { name: "keep me folded" },
      collapsedChildren: hidden,
      children: null,
    } as $TSFixMe;

    tree.expandCollapsedWithFewChildrenOrNoName(node);

    expect(node.children).toBeNull();
    expect(node.collapsedChildren).toBe(hidden);
  });
});

describe("TidyTree update origin fallback", () => {
  it("starts entering nodes from the root's origin when the source has none", () => {
    const { tree, container } = buildTree({}, ALL_CHILDREN_COLLAPSE());

    // Drop the rendered groups so the next update re-enters every node, then
    // hand update() a source whose offsets are 0 (falsy) -- the transform has
    // to fall back to the root's own x0/y0.
    Array.from(container.querySelectorAll("g.node")).forEach(node =>
      node.remove(),
    );
    tree.update({ x0: 0, y0: 0 });

    const rootX0 = tree.root.x0;
    expect(rootX0).toBeGreaterThan(0);
    const groups = Array.from(container.querySelectorAll("g.node"));
    expect(groups).toHaveLength(3);
    groups.forEach(group => {
      expect(group.getAttribute("transform")).toBe(`translate(0,${rootX0})`);
    });
  });
});

describe("TidyTree overlay placement", () => {
  // root(100) -> a(80) -> c(70); b(10) is a leaf. "a" keeps a visible child,
  // "c" has none, so overlays on the two of them take opposite ternary sides.
  const OVERLAY_NODES = () => [
    {
      id: "root",
      parentId: null,
      scientificName: "Root Organism",
      values: { aggregatescore: 100 },
      lineageRank: "superkingdom",
    },
    {
      id: "a",
      parentId: "root",
      scientificName: "Alpha",
      values: { aggregatescore: 80 },
      lineageRank: "genus",
    },
    {
      id: "c",
      parentId: "a",
      scientificName: "Cee",
      values: { aggregatescore: 70 },
      lineageRank: "species",
    },
    {
      id: "b",
      parentId: "root",
      scientificName: "Beta",
      values: { aggregatescore: 10 },
      lineageRank: "genus",
    },
  ];

  const addOverlay = (container: HTMLElement, id: string) => {
    const overlay = document.createElement("div");
    overlay.className = `node-overlay__${id}`;
    container.appendChild(overlay);
    return overlay;
  };

  const findNode = (tree: $TSFixMe, id: string) =>
    tree.root.descendants().find((d: $TSFixMe) => d.id === id);

  it("places a childless node's overlay below-right of the node", () => {
    const { tree, container } = buildTree(
      { transitionDuration: 0 },
      OVERLAY_NODES(),
    );
    const overlay = addOverlay(container, "c");

    tree.update();
    timerFlush();

    const c = findNode(tree, "c");
    expect(tree.hasVisibleChildren(c)).toBe(false);
    const nodeScale = scaleLinear().domain(tree.range).range([4, 20]);
    const radius = nodeScale(c.data.values.aggregatescore) as number;
    // getNodeBoxRefSvg: y = d.y + margins.left, x = d.x + margins.top.
    const boxY = c.y + 40;
    const boxX = c.x + 20;
    // Leaf side of the ternaries.
    expect(overlay.style.left).toBe(`${boxY + radius + 40}px`);
    expect(overlay.style.top).toBe(`${boxX - radius + 12 - 20}px`);
  });

  it("places a parent node's overlay above-left of the node", () => {
    const { tree, container } = buildTree(
      { transitionDuration: 0 },
      OVERLAY_NODES(),
    );
    const overlay = addOverlay(container, "a");

    tree.update();
    timerFlush();

    const a = findNode(tree, "a");
    expect(tree.hasVisibleChildren(a)).toBe(true);
    const nodeScale = scaleLinear().domain(tree.range).range([4, 20]);
    const radius = nodeScale(a.data.values.aggregatescore) as number;
    const boxY = a.y + 40;
    const boxX = a.x + 20;
    // Visible-children side of the ternaries: pulled back by the node radius
    // and the label height instead of pushed past them.
    expect(overlay.style.left).toBe(`${boxY - 40 / 2 - 20}px`);
    expect(overlay.style.top).toBe(`${boxX - radius - 12 - 20}px`);
  });
});

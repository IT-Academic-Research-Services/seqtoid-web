// Coverage for app/assets/src/components/visualizations/TidyTree/TidyTree.ts
//
// TidyTree is a plain D3 class (no React), so it is driven directly: build it
// against a jsdom container with a hand-made taxon tree, then assert on the
// hierarchy it derives and on the SVG it emits.
//
// Most of the value is in the pure tree logic -- which children get folded into
// `collapsedChildren`, when an aggregated "(n)" node is synthesised, and how
// toggleCollapseNode cycles a node through visible / hidden / collapsed. Those
// are asserted on the hierarchy itself, with no DOM involved. The render tests
// assert countable, synchronously-set outcomes (how many nodes, which label,
// which radius); anything TidyTree sets through a D3 transition is deliberately
// not asserted, because transitions land asynchronously.
//
// Two pieces of environment are supplied that jsdom does not have:
//   * d3-transition. TidyTree calls selection.transition() but never imports
//     the module -- in the app bundle another visualization (Dendogram) pulls
//     it in, which installs it on the shared selection prototype. Importing it
//     here reproduces that, rather than papering over anything.
//   * SVG text metrics. jsdom implements no SVG layout, so getBBox and
//     getComputedTextLength do not exist. Both are stubbed; getComputedTextLength
//     is made adjustable so the label-wrapping branch can be driven from a test.
import "d3-transition";
import { TidyTree } from "~/components/visualizations/TidyTree/TidyTree";

let computedTextLength = 0;
const getBBox = jest.fn(() => ({ x: 0, y: 0, width: 40, height: 12 }));

beforeAll(() => {
  const proto = SVGElement.prototype as $TSFixMe;
  proto.getBBox = getBBox;
  proto.getComputedTextLength = () => computedTextLength;
});

beforeEach(() => {
  document.body.innerHTML = "";
  computedTextLength = 0;
  getBBox.mockClear();
});

// A root with two branches. Scores are chosen so that, with the default 0.4
// collapse threshold, node "a" keeps one visible child and folds three away
// (which is more than minNonCollapsableChildren, so an aggregated node is
// synthesised), while the root folds only one child away (which is not, so it
// keeps all of them).
//
//   root(100)
//     +-- a(80)
//     |     +-- c(70)  d(5)  e(4)  f(3)
//     +-- b(10)
const NODES = () => [
  {
    id: "root",
    parentId: null,
    scientificName: "Root Organism",
    commonName: "Root",
    values: { aggregatescore: 100, nt_r: 100 },
    lineageRank: "superkingdom",
  },
  {
    id: "a",
    parentId: "root",
    scientificName: "Alpha",
    commonName: "alpha common",
    values: { aggregatescore: 80, nt_r: 80 },
    lineageRank: "genus",
  },
  {
    id: "b",
    parentId: "root",
    scientificName: "Beta",
    values: { aggregatescore: 10, nt_r: 10 },
    lineageRank: "genus",
  },
  {
    id: "c",
    parentId: "a",
    scientificName: "Cee",
    values: { aggregatescore: 70, nt_r: 70 },
    lineageRank: "species",
  },
  {
    id: "d",
    parentId: "a",
    scientificName: "Dee",
    values: { aggregatescore: 5, nt_r: 60 },
    lineageRank: "species",
  },
  {
    id: "e",
    parentId: "a",
    scientificName: "Eee",
    values: { aggregatescore: 4, nt_r: 55 },
    lineageRank: "species",
  },
  {
    id: "f",
    parentId: "a",
    scientificName: "Eff",
    values: { aggregatescore: 3, nt_r: 3 },
    lineageRank: "species",
  },
];

function makeContainer() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

function buildTree(options: $TSFixMe = {}, nodes: $TSFixMe = NODES()) {
  const container = makeContainer();
  const tree = new TidyTree(container, nodes, options);
  return { tree, container };
}

const ids = (nodes: $TSFixMe) =>
  (nodes || []).map((node: $TSFixMe) => node.id ?? node.data.id);

const childOf = (parent: $TSFixMe, id: string) =>
  parent.children.find((child: $TSFixMe) => child.id === id);

describe("visualizations/TidyTree", () => {
  describe("constructor", () => {
    it("applies the documented defaults", () => {
      const { tree } = buildTree();
      expect(tree.options.attribute).toBe("aggregatescore");
      expect(tree.options.collapseThreshold).toBe(0.4);
      expect(tree.options.minNonCollapsableChildren).toBe(2);
      expect(tree.options.useCommonName).toBe(false);
      expect(tree.options.addOverlays).toBe(true);
      expect(tree.options.svgBackgroundColor).toBe("white");
    });

    it("lets caller options override the defaults", () => {
      const { tree } = buildTree({
        collapseThreshold: 0.9,
        svgBackgroundColor: "black",
      });
      expect(tree.options.collapseThreshold).toBe(0.9);
      expect(tree.options.svgBackgroundColor).toBe("black");
      // Untouched defaults survive the merge.
      expect(tree.options.minWidth).toBe(960);
    });

    it("tolerates a null options bag", () => {
      const container = makeContainer();
      const tree = new TidyTree(container, NODES(), null);
      expect(tree.options.attribute).toBe("aggregatescore");
      expect(tree.root.id).toBe("root");
    });

    it("stratifies the flat node list into a hierarchy", () => {
      const { tree } = buildTree();
      expect(tree.root.id).toBe("root");
      expect(ids(tree.root.children)).toEqual(["a", "b"]);
    });

    it("hands the freshly built root to onCreatedTree", () => {
      const onCreatedTree = jest.fn();
      const { tree } = buildTree({ onCreatedTree });
      expect(onCreatedTree).toHaveBeenCalledTimes(1);
      expect(onCreatedTree.mock.calls[0][0]).toBe(tree.root);
    });

    it("derives the value range from the leaves and the root", () => {
      const { tree } = buildTree();
      expect(tree.range).toEqual([3, 100]);
    });
  });

  describe("sortAndScaleTree", () => {
    it("sorts siblings by the scoring attribute, descending", () => {
      const { tree } = buildTree();
      expect(ids(tree.root.children)).toEqual(["a", "b"]);
    });

    it("folds away low-scoring children and keeps the high-scoring one", () => {
      const { tree } = buildTree();
      const a = childOf(tree.root, "a");
      expect(ids(a.collapsedChildren)).toEqual(["d", "e", "f"]);
      expect(ids(a.children)).toEqual(["c", "other-a"]);
    });

    it("synthesises an aggregated node describing what was folded away", () => {
      const { tree } = buildTree();
      const a = childOf(tree.root, "a");
      const aggregated = a.children[1];
      expect(aggregated.isAggregated).toBe(true);
      expect(aggregated.data.scientificName).toBe("(3)");
      expect(aggregated.data.commonName).toBe("(3)");
      expect(aggregated.data.highlight).toBe(false);
      expect(aggregated.parent).toBe(a);
      expect(aggregated.depth).toBe(a.depth + 1);
      // It borrows the rank and values of the highest-scoring folded child.
      expect(aggregated.data.lineageRank).toBe("species");
      expect(aggregated.data.values).toBe(a.collapsedChildren[0].data.values);
    });

    it("does not fold anything away when too few children qualify", () => {
      const { tree } = buildTree();
      // Only "b" scores below the threshold, and one child is not more than
      // minNonCollapsableChildren, so the root keeps both children as-is.
      expect(tree.root.collapsedChildren).toBeNull();
      expect(ids(tree.root.children)).toEqual(["a", "b"]);
    });

    it("collapses a low-scoring node's own subtree", () => {
      const { tree } = buildTree();
      const b = childOf(tree.root, "b");
      expect(b.children).toBeNull();
    });

    it("collapses any node named in the `collapsed` option regardless of score", () => {
      const { tree } = buildTree({ collapsed: new Set(["a"]) });
      const a = childOf(tree.root, "a");
      expect(a.children).toBeNull();
      expect(ids(a.collapsedChildren)).toEqual(["c", "d", "e", "f"]);
    });

    it("never folds away a highlighted child", () => {
      const nodes = NODES();
      // "f" is the lowest scoring leaf; highlighting it must keep it visible,
      // which drops the folded count to 2 and so suppresses the aggregate node.
      nodes[6] = { ...nodes[6], highlight: true } as $TSFixMe;
      const { tree } = buildTree({}, nodes);
      const a = childOf(tree.root, "a");
      expect(a.collapsedChildren).toBeNull();
      expect(ids(a.children)).toEqual(["c", "d", "e", "f"]);
    });

    it("raising the threshold collapses more of the tree", () => {
      const { tree } = buildTree({ collapseThreshold: 0.9 });
      const a = childOf(tree.root, "a");
      expect(a.children).toBeNull();
      expect(ids(a.collapsedChildren)).toEqual(["c", "d", "e", "f"]);
    });
  });

  describe("resetTree", () => {
    it("restores every folded child and drops the aggregated nodes", () => {
      const { tree } = buildTree();
      tree.resetTree();
      const a = childOf(tree.root, "a");
      expect(ids(a.children)).toEqual(["c", "d", "e", "f"]);
      expect(a.collapsedChildren).toBeNull();
      expect(a.hiddenChildren).toBeNull();
      expect(ids(tree.root.children)).toEqual(["a", "b"]);
    });

    it("restores children that were hidden by a toggle", () => {
      const { tree } = buildTree();
      const a = childOf(tree.root, "a");
      tree.toggleCollapseNode(a);
      expect(a.hiddenChildren).not.toBeNull();

      tree.resetTree();
      expect(a.hiddenChildren).toBeNull();
      expect(ids(a.children)).toEqual(["c", "d", "e", "f"]);
    });
  });

  describe("setOptions", () => {
    it("re-derives the tree when the scoring attribute changes", () => {
      const { tree } = buildTree();
      tree.setOptions({ attribute: "nt_r" });
      expect(tree.options.attribute).toBe("nt_r");
      // Under nt_r only "f" falls below the collapse threshold, and a single
      // child is not more than minNonCollapsableChildren, so nothing is folded.
      const a = childOf(tree.root, "a");
      expect(a.collapsedChildren).toBeNull();
      expect(ids(a.children)).toEqual(["c", "d", "e", "f"]);
    });

    it("merges options that do not affect the layout without re-deriving", () => {
      const { tree } = buildTree();
      const a = childOf(tree.root, "a");
      const childrenBefore = a.children;
      tree.setOptions({ useCommonName: true });
      expect(tree.options.useCommonName).toBe(true);
      expect(childOf(tree.root, "a").children).toBe(childrenBefore);
    });

    it("refuses to render, and says so, when the attribute is blank", () => {
      const { tree, container } = buildTree();
      const consoleError = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const nodesBefore = container.querySelectorAll("g.node").length;

      tree.setOptions({ attribute: "" });

      expect(consoleError).toHaveBeenCalledWith(
        "TidyTree: Option 'attribute' is not defined.",
      );
      expect(container.querySelectorAll("g.node")).toHaveLength(nodesBefore);
      consoleError.mockRestore();
    });
  });

  describe("toggleCollapseNode", () => {
    it("hides the visible children of a partially collapsed node", () => {
      const onCollapsedStateChange = jest.fn();
      const { tree } = buildTree({ onCollapsedStateChange });
      const a = childOf(tree.root, "a");

      tree.toggleCollapseNode(a);

      expect(a.children).toBeNull();
      expect(ids(a.collapsedChildren)).toEqual(["c", "other-a"]);
      expect(ids(a.hiddenChildren)).toEqual(["d", "e", "f"]);
      expect(onCollapsedStateChange).toHaveBeenCalledWith(a);
    });

    it("brings the hidden children back on the second toggle", () => {
      const { tree } = buildTree();
      const a = childOf(tree.root, "a");

      tree.toggleCollapseNode(a);
      tree.toggleCollapseNode(a);

      expect(ids(a.children)).toEqual(["c", "other-a"]);
      expect(ids(a.collapsedChildren)).toEqual(["d", "e", "f"]);
      expect(a.hiddenChildren).toBeNull();
    });

    it("collapses a fully expanded node into its collapsedChildren", () => {
      const { tree } = buildTree();
      const root = tree.root;
      expect(root.collapsedChildren).toBeNull();

      tree.toggleCollapseNode(root);

      expect(root.children).toBeNull();
      expect(ids(root.collapsedChildren)).toEqual(["a", "b"]);
    });

    it("expanding an aggregated node splices its siblings back into the parent", () => {
      const { tree } = buildTree();
      const a = childOf(tree.root, "a");
      const aggregated = a.children[1];

      tree.toggleCollapseNode(aggregated);

      expect(ids(a.children)).toEqual(["c", "d", "e", "f"]);
      expect(a.collapsedChildren).toBeNull();
    });

    it("is a no-op for a leaf with nothing to collapse", () => {
      const onCollapsedStateChange = jest.fn();
      const { tree } = buildTree({ onCollapsedStateChange });
      const b = childOf(tree.root, "b");

      tree.toggleCollapseNode(b);

      expect(b.children).toBeNull();
      expect(b.hiddenChildren == null).toBe(true);
      // The listener still hears about the interaction.
      expect(onCollapsedStateChange).toHaveBeenCalledWith(b);
    });

    it("records the node's previous position so the transition starts there", () => {
      const { tree } = buildTree();
      const a = childOf(tree.root, "a");
      tree.toggleCollapseNode(a);
      expect(typeof a.x0).toBe("number");
      expect(typeof a.y0).toBe("number");
    });
  });

  describe("expandCollapsedWithFewChildrenOrNoName", () => {
    it("ignores a missing node", () => {
      const { tree } = buildTree();
      expect(
        tree.expandCollapsedWithFewChildrenOrNoName(undefined),
      ).toBeUndefined();
    });

    it("leaves a named node with plenty of folded children alone", () => {
      const { tree } = buildTree();
      const collapsed = [1, 2, 3, 4, 5].map(n => ({ id: n, data: {} }));
      const node = {
        data: { name: "named" },
        children: null,
        collapsedChildren: collapsed,
      };

      tree.expandCollapsedWithFewChildrenOrNoName(node);

      expect(node.collapsedChildren).toBe(collapsed);
      expect(node.children).toBeNull();
    });

    it("expands a node with only a couple of folded children", () => {
      const { tree } = buildTree();
      const node = {
        data: { name: "named" },
        children: null,
        collapsedChildren: [
          { id: 1, data: {} },
          { id: 2, data: {} },
        ],
      };

      tree.expandCollapsedWithFewChildrenOrNoName(node);

      expect(node.collapsedChildren).toBeNull();
      expect(ids(node.children)).toEqual([1, 2]);
    });

    it("expands a nameless node however many children it folded away", () => {
      const { tree } = buildTree();
      const node = {
        data: {},
        children: [{ id: 0, data: {} }],
        collapsedChildren: [1, 2, 3, 4, 5].map(n => ({ id: n, data: {} })),
      };

      tree.expandCollapsedWithFewChildrenOrNoName(node);

      expect(node.collapsedChildren).toBeNull();
      expect(ids(node.children)).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it("keeps expanding down the tree", () => {
      const { tree } = buildTree();
      const grandchild = {
        id: "gc",
        data: {},
        children: null,
        collapsedChildren: [{ id: "ggc", data: {} }],
      };
      const node = {
        data: {},
        children: null,
        collapsedChildren: [grandchild],
      };

      tree.expandCollapsedWithFewChildrenOrNoName(node);

      expect(node.collapsedChildren).toBeNull();
      expect(grandchild.collapsedChildren).toBeNull();
      expect(ids(grandchild.children)).toEqual(["ggc"]);
    });
  });

  describe("pure geometry helpers", () => {
    it("curvedPath draws a cubic bezier between the two points", () => {
      const { tree } = buildTree();
      const path = tree
        .curvedPath({ x: 2, y: 1 }, { x: 5, y: 4 })
        .replace(/\s+/g, " ");
      expect(path).toBe("M 1 2 C 2.5 2, 2.5 5, 4 5");
    });

    it("getNodeBoxRefSvg offsets the node position by the svg margins", () => {
      const { tree } = buildTree();
      const node = { getBBox: () => ({ width: 30, height: 12 }) };
      expect(tree.getNodeBoxRefSvg({ x: 5, y: 7 }, node)).toEqual({
        x: 25,
        y: 47,
        width: 30,
        height: 12,
      });
    });
  });

  describe("child-state predicates", () => {
    // Built per test: the SVG metric stubs are only installed in beforeAll,
    // which runs after the describe bodies are evaluated.
    let tree: $TSFixMe;
    beforeEach(() => {
      tree = buildTree().tree;
    });

    it.each([
      ["fully collapsed", { children: null, collapsedChildren: [1] }, true],
      ["partially collapsed", { children: [1], collapsedChildren: [2] }, false],
      ["a bare leaf", { children: null, collapsedChildren: null }, false],
    ])("hasAllChildrenCollapsed(%s)", (_name, node, expected) => {
      expect(tree.hasAllChildrenCollapsed(node)).toBe(expected);
    });

    it.each([
      ["fully visible", { children: [1], collapsedChildren: null }, true],
      ["partially collapsed", { children: [1], collapsedChildren: [2] }, false],
      ["a bare leaf", { children: null, collapsedChildren: null }, false],
    ])("hasAllChildrenVisible(%s)", (_name, node, expected) => {
      expect(tree.hasAllChildrenVisible(node)).toBe(expected);
    });

    it("hasChildren is true whenever children exist in either bucket", () => {
      expect(tree.hasChildren({ children: [1] })).toBe(true);
      expect(tree.hasChildren({ collapsedChildren: [1] })).toBe(true);
      expect(tree.hasChildren({ children: null })).toBe(false);
    });

    it("hasHiddenChildren and hasVisibleChildren look at one bucket each", () => {
      const partial = { children: [1], collapsedChildren: [2] };
      expect(tree.hasHiddenChildren(partial)).toBe(true);
      expect(tree.hasVisibleChildren(partial)).toBe(true);
      expect(tree.hasHiddenChildren({ children: [1] })).toBe(false);
      expect(tree.hasVisibleChildren({ collapsedChildren: [1] })).toBe(false);
    });
  });

  describe("rendering", () => {
    it("creates a single background-coloured svg", () => {
      const { container } = buildTree({ svgBackgroundColor: "cornsilk" });
      const svgs = container.querySelectorAll("svg.tidy-tree");
      expect(svgs).toHaveLength(1);
      expect(svgs[0].getAttribute("style")).toBe("background-color: cornsilk");
    });

    it("does not create a second svg when it re-renders", () => {
      const { tree, container } = buildTree();
      tree.update();
      expect(container.querySelectorAll("svg")).toHaveLength(1);
    });

    it("draws one group per visible node and one link per edge", () => {
      const { container } = buildTree();
      // root, a, b, c and the aggregated node.
      expect(container.querySelectorAll("g.node")).toHaveLength(5);
      expect(container.querySelectorAll("path.link")).toHaveLength(4);
    });

    it("draws the collapse cross only on nodes that have children", () => {
      const { container } = buildTree();
      // root and "a" have children; the aggregated node is expandable too.
      // "b" and "c" are leaves.
      expect(container.querySelectorAll("path.cross")).toHaveLength(3);
    });

    it("labels nodes with their scientific name by default", () => {
      const { container } = buildTree();
      const labels = Array.from(container.querySelectorAll("g.node text")).map(
        node => node.textContent,
      );
      expect(labels).toContain("Root Organism");
      expect(labels).toContain("Alpha");
      expect(labels).toContain("(3)");
    });

    it("prefers the common name when asked, falling back when there is none", () => {
      const { container } = buildTree({ useCommonName: true });
      const labels = Array.from(container.querySelectorAll("g.node text")).map(
        node => node.textContent,
      );
      expect(labels).toContain("alpha common");
      // "Beta" has no common name, so the scientific name is used instead.
      expect(labels).toContain("Beta");
      expect(labels).not.toContain("Alpha");
    });

    it("sizes each node's circle from its score, and hides unnamed nodes", () => {
      const nodes = NODES();
      // A leaf with no name and nothing hidden below it should be invisible.
      nodes.push({
        id: "nameless",
        parentId: "root",
        scientificName: "",
        values: { aggregatescore: 90, nt_r: 1 },
        lineageRank: "genus",
      } as $TSFixMe);
      const { container } = buildTree({}, nodes);

      const radii: Record<string, string | null> = {};
      container.querySelectorAll("g.node").forEach(node => {
        const label = node.querySelector("text");
        const circle = node.querySelector("circle");
        radii[label ? (label.textContent as string) : ""] = circle
          ? circle.getAttribute("r")
          : null;
      });

      // The root sits at the top of the 4..20 radius scale.
      expect(Number(radii["Root Organism"])).toBeCloseTo(20);
      expect(Number(radii["Alpha"])).toBeGreaterThan(4);
      expect(Number(radii["Alpha"])).toBeLessThan(20);
      // The nameless node renders an empty label and a zero radius.
      expect(radii[""]).toBe("0");
    });

    it("wraps a long label onto several tspans", () => {
      computedTextLength = 999;
      const { container } = buildTree();
      const rootLabel = Array.from(
        container.querySelectorAll("g.node text"),
      ).find(node => (node.textContent || "").includes("Organism"));
      expect(rootLabel).toBeDefined();
      expect(
        (rootLabel as Element).querySelectorAll("tspan").length,
      ).toBeGreaterThan(1);
    });

    it("keeps a short label on a single tspan", () => {
      const { container } = buildTree();
      const rootLabel = Array.from(
        container.querySelectorAll("g.node text"),
      ).find(node => node.textContent === "Root Organism");
      expect(rootLabel).toBeDefined();
      expect((rootLabel as Element).querySelectorAll("tspan")).toHaveLength(1);
    });

    it("clicking a node's clickable group toggles it", () => {
      const onCollapsedStateChange = jest.fn();
      const { container } = buildTree({ onCollapsedStateChange });
      const clickable = container.querySelector("g.clickable") as Element;

      clickable.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(onCollapsedStateChange).toHaveBeenCalledTimes(1);
      expect(onCollapsedStateChange.mock.calls[0][0].id).toBe("root");
    });

    it("routes label clicks to onNodeLabelClick", () => {
      const onNodeLabelClick = jest.fn();
      const { container } = buildTree({ onNodeLabelClick });
      const label = container.querySelector("g.node text") as Element;

      label.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(onNodeLabelClick).toHaveBeenCalledTimes(1);
      expect(onNodeLabelClick.mock.calls[0][0].id).toBe("root");
    });

    it("shows, moves and hides the tooltip as the pointer crosses a node", () => {
      const tooltipContainer = document.createElement("div");
      document.body.appendChild(tooltipContainer);
      const onNodeHover = jest.fn();
      const { container } = buildTree({ tooltipContainer, onNodeHover });
      const node = container.querySelector("g.node") as Element;

      node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      expect(onNodeHover).toHaveBeenCalledTimes(1);
      expect(onNodeHover.mock.calls[0][0].id).toBe("root");
      expect(tooltipContainer.classList.contains("visible")).toBe(true);

      // jsdom's MouseEvent does not implement pageX/pageY, which is what the
      // tooltip positioning reads.
      const move = new MouseEvent("mousemove", { bubbles: true });
      Object.defineProperty(move, "pageX", { value: 30 });
      Object.defineProperty(move, "pageY", { value: 40 });
      node.dispatchEvent(move);
      expect(tooltipContainer.style.left).toBe("50px");
      expect(tooltipContainer.style.top).toBe("60px");

      node.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
      expect(tooltipContainer.classList.contains("visible")).toBe(false);
    });

    it("moves the tooltip even when no hover callback was supplied", () => {
      const tooltipContainer = document.createElement("div");
      document.body.appendChild(tooltipContainer);
      const { container } = buildTree({ tooltipContainer });
      const node = container.querySelector("g.node") as Element;

      node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      expect(tooltipContainer.classList.contains("visible")).toBe(true);
    });

    it("only measures label geometry when a matching overlay exists", () => {
      const { tree, container } = buildTree();
      getBBox.mockClear();
      tree.update();
      expect(getBBox).not.toHaveBeenCalled();

      const overlay = document.createElement("div");
      overlay.className = "node-overlay__root";
      overlay.innerHTML = '<div class="pathogen-label">flu</div>';
      container.appendChild(overlay);

      tree.update();
      expect(getBBox).toHaveBeenCalled();
    });

    it("skips the overlay pass entirely when overlays are switched off", () => {
      const { tree, container } = buildTree({ addOverlays: false });
      const overlay = document.createElement("div");
      overlay.className = "node-overlay__root";
      container.appendChild(overlay);
      getBBox.mockClear();

      tree.update();

      expect(getBBox).not.toHaveBeenCalled();
    });

    it("drops the groups for nodes that a collapse removed", () => {
      const { tree, container } = buildTree();
      expect(container.querySelectorAll("g.node")).toHaveLength(5);

      tree.toggleCollapseNode(tree.root);

      // The exit selection is removed through a transition, so the groups are
      // still in the DOM here; what is asserted is that the data join now
      // covers the root alone.
      expect(tree.root.children).toBeNull();
      expect(tree.root.descendants()).toHaveLength(1);
    });
  });
});

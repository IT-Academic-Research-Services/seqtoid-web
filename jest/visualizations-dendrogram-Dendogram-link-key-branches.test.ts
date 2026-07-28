// CZID-586 (#586) frontend coverage wave 4 -- residual branch closure for
// Dendogram.ts.
//
// jest/Dendogram.test.ts drives the happy paths and
// jest/visualizations-dendrogram-Dendogram-branches.test.ts already closed the
// bulk of the off-path conditionals. The one reachable branch still left is the
// `return null` arm of the `linkId` key function inside update(): the data join
// at Dendogram.ts:595 feeds it `root.descendants().slice(1)`, which by
// construction never contains a parentless node, so the guard's false side only
// runs when d3 re-keys an *already bound* datum whose parent has since gone
// away -- i.e. after detachFromParent() has deleted it.
//
// The two shims match the sibling specs and exist for the same reasons: jsdom
// has no SVG layout engine (no getBBox), and addSvgColorFilter parses hex values
// out of a scss module that jest maps to an empty object.
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
}

// root -> (mid -> alpha, beta), gamma. Four links, and gamma is a leaf hanging
// straight off the root so detaching it leaves the rest of the tree intact.
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

function build(options: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dendogram = new Dendogram(container, makeDeepTree(), options);
  return { container, dendogram };
}

function boundDatum(el: Element) {
  return (
    el as unknown as { __data__: { data: { id: string }; parent?: unknown } }
  ).__data__;
}

function linkPaths(container: HTMLElement) {
  return Array.from(container.querySelectorAll("path.link"));
}

beforeEach(() => {
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

// Note on the `toThrow` wrappers below: a *second* update() trips a live defect
// at Dendogram.ts:647, where the node-label stroke tween reads `this.colors`
// while `this` is the DOM element rather than the Dendogram. d3 evaluates that
// tween eagerly inside .attr(), so the TypeError escapes update() synchronously.
// The data join under test happens at Dendogram.ts:593-607, well before that, so
// everything asserted here is state committed before the throw. The throw itself
// is asserted so the defect stays pinned instead of being silently swallowed.
describe("Dendogram link keying when a node has lost its parent", () => {
  it("keys a parentless bound datum as null so it is never re-matched to a live link", () => {
    const { container, dendogram } = build();
    dendogram.update();

    // root-mid, mid-a, mid-b, root-c
    expect(linkPaths(container)).toHaveLength(4);
    const gammaLink = linkPaths(container).find(
      el => boundDatum(el).data.id === "c",
    );
    expect(gammaLink).toBeDefined();

    const gamma = dendogram.root.children.find(
      (child: { data: { id: string } }) => child.data.id === "c",
    );
    dendogram.detachFromParent(gamma);
    // Precondition for the branch: the datum still bound to gammaLink now has
    // no parent, which is exactly the case linkId's guard falls through on.
    expect(gamma.parent).toBeUndefined();
    expect(boundDatum(gammaLink as Element)).toBe(gamma);

    expect(() => dendogram.update()).toThrow(TypeError);

    // linkId returned null for gamma, so it matched none of the three live
    // link keys and dropped into exit(): nothing new was appended (the enter
    // selection was empty because the surviving keys all found their existing
    // element), and gamma's element is still bound to the parentless node
    // rather than having been recycled for a different link.
    const after = linkPaths(container);
    expect(after).toHaveLength(4);
    expect(boundDatum(gammaLink as Element)).toBe(gamma);
    expect(after.map(el => boundDatum(el).data.id).sort()).toEqual([
      "a",
      "b",
      "c",
      "mid",
    ]);
  });

  it("keys every still-attached node by its parent-child pair", () => {
    const { container, dendogram } = build();
    dendogram.update();

    // The true side of the same guard: each rendered link's datum has a parent,
    // so it gets a real composite key and the second join reuses the very same
    // element instead of appending a duplicate.
    const before = linkPaths(container);
    expect(before).toHaveLength(4);
    before.forEach(el => expect(boundDatum(el).parent).toBeDefined());

    expect(() => dendogram.update()).toThrow(TypeError);

    const after = linkPaths(container);
    expect(after).toHaveLength(4);
    after.forEach((el, i) => expect(el).toBe(before[i]));
  });
});

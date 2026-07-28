// Coverage for app/assets/src/components/visualizations/GenomeViz.ts
//
// GenomeViz is a plain D3 class (no React), so it is driven directly: build it
// against a jsdom container, run update() to emit the bars, then call the hit
// testing and highlight methods and assert on what comes back and on the SVG
// that was produced.
//
// The interesting logic is getDataIndexForSvgX -- a two-pass hit test that
// prefers the smallest overlapping bar and otherwise falls back to the nearest
// bar within `hoverBuffer`. It is exercised against hand-written endpoints so
// the expected answers do not depend on the D3 scale, and then the mouse
// handlers are driven on top of the real endpoints produced by update().
//
// d3-selection's `mouse()` reads a live browser event and needs SVG geometry
// jsdom does not implement, and `event` is a live module binding D3 sets during
// dispatch. Both are stubbed (same approach as jest/Histogram.test.ts) so the
// hover/click paths are reachable deterministically. Everything else in
// d3-selection is the real implementation.
const mockState: { mouseX: number; event: unknown } = {
  mouseX: 0,
  event: { clientX: 111, clientY: 222 },
};

jest.mock("d3-selection", () => {
  const actual = jest.requireActual("d3-selection");
  return {
    ...actual,
    mouse: jest.fn(() => [mockState.mouseX, 0]),
    get event() {
      return mockState.event;
    },
  };
});

import GenomeViz from "~/components/visualizations/GenomeViz";

const DEFAULT_COLOR = "#006BE9";

// jsdom reports clientWidth/clientHeight as 0, which would silently push the
// constructor onto its 800x400 fallback.
function makeContainer(width = 500, height = 100) {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: width });
  Object.defineProperty(container, "clientHeight", { value: height });
  document.body.appendChild(container);
  return container;
}

// Two bars: a wide one and a narrow one nested inside it.
const DATA = [
  [0, 100],
  [40, 50],
];

function buildViz(data: $TSFixMe = DATA, options: $TSFixMe = {}) {
  const container = makeContainer();
  const viz = new GenomeViz(container, data, options);
  return { viz, container };
}

beforeEach(() => {
  document.body.innerHTML = "";
  mockState.mouseX = 0;
  mockState.event = { clientX: 111, clientY: 222 };
});

describe("visualizations/GenomeViz", () => {
  describe("constructor", () => {
    it("applies the default colour and hover options", () => {
      const { viz } = buildViz();
      expect(viz.options.color).toBe(DEFAULT_COLOR);
      expect(viz.options.hoverBuffer).toBe(5);
      expect(viz.options.hoverDarkenFactor).toBe(0.25);
    });

    it("lets caller options override the defaults", () => {
      const { viz } = buildViz(DATA, { color: "#ff0000", hoverBuffer: 25 });
      expect(viz.options.color).toBe("#ff0000");
      expect(viz.options.hoverBuffer).toBe(25);
      // Untouched defaults survive the merge.
      expect(viz.options.hoverDarkenFactor).toBe(0.25);
    });

    it("defaults every margin to zero when none are supplied", () => {
      const { viz } = buildViz();
      expect(viz.margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    });

    it("keeps caller-supplied margins", () => {
      const margins = { top: 1, right: 2, bottom: 3, left: 4 };
      const { viz } = buildViz(DATA, { margins });
      expect(viz.margins).toBe(margins);
    });

    it("sizes the svg from the container", () => {
      const { viz, container } = buildViz();
      const svg = container.querySelector("svg") as SVGElement;
      expect(svg).not.toBeNull();
      expect(svg.getAttribute("width")).toBe("500");
      expect(svg.getAttribute("height")).toBe("100");
      expect(viz.size).toEqual({ width: 500, height: 100 });
    });

    it("falls back to 800x400 when the container has no measured size", () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const viz = new GenomeViz(container, DATA, {});
      expect(viz.size).toEqual({ width: 800, height: 400 });
    });

    it("removes a previously rendered chart before drawing a new one", () => {
      const container = makeContainer();
      new GenomeViz(container, DATA, {});
      new GenomeViz(container, DATA, {});
      expect(container.querySelectorAll("svg")).toHaveLength(1);
    });

    it("starts with no hover state and no bar endpoints", () => {
      const { viz } = buildViz();
      expect(viz.lastHoveredDataIndex).toBeNull();
      expect(viz.barEndpoints).toBeNull();
    });
  });

  describe("getDomain", () => {
    it("returns the caller-supplied domain untouched", () => {
      const domain = [-5, 5];
      const { viz } = buildViz(DATA, { domain });
      expect(viz.getDomain()).toBe(domain);
    });

    it("spans the min and max across every series", () => {
      const { viz } = buildViz([
        [10, 20],
        [5, 30],
        [12, 14],
      ]);
      expect(viz.getDomain()).toEqual([5, 30]);
    });

    it("handles a single series", () => {
      const { viz } = buildViz([[3, 7]]);
      expect(viz.getDomain()).toEqual([3, 7]);
    });
  });

  describe("update", () => {
    it("does nothing when there is no data", () => {
      const { viz, container } = buildViz(null);
      viz.update();
      expect(container.querySelectorAll("g")).toHaveLength(0);
      expect(viz.barEndpoints).toBeNull();
    });

    it("draws one rect per datum in the bar container", () => {
      const { viz, container } = buildViz();
      viz.update();
      const bars = container.querySelectorAll(".bar-container rect");
      expect(bars).toHaveLength(2);
      expect(bars[0].getAttribute("fill")).toBe(DEFAULT_COLOR);
    });

    it("records one endpoint triple per datum, in data order", () => {
      const { viz } = buildViz();
      viz.update();
      expect(viz.barEndpoints).toHaveLength(2);
      expect(viz.barEndpoints[0][2]).toBe(0);
      expect(viz.barEndpoints[1][2]).toBe(1);
      // The first datum starts at the left edge and ends at the right edge of
      // the (0..100 -> 0..500) scale.
      expect(viz.barEndpoints[0][0]).toBeCloseTo(0);
      expect(viz.barEndpoints[0][1]).toBeCloseTo(500);
      // The nested bar is strictly inside the wide one.
      expect(viz.barEndpoints[1][0]).toBeGreaterThan(viz.barEndpoints[0][0]);
      expect(viz.barEndpoints[1][1]).toBeLessThan(viz.barEndpoints[0][1]);
    });

    it("creates the highlight and outline containers and the hover target", () => {
      const { viz, container } = buildViz();
      viz.update();
      expect(container.querySelectorAll(".highlight-container")).toHaveLength(
        1,
      );
      expect(container.querySelectorAll(".outline-container")).toHaveLength(1);
      expect(
        container.querySelector('rect[style="fill: transparent"]'),
      ).not.toBeNull();
    });
  });

  describe("getDataIndexForSvgX", () => {
    // Bar 0 spans 0..100, bar 1 is the narrower 40..50 nested inside it, and
    // bar 2 sits well to the right with a gap in between.
    const endpoints = [
      [0, 100, 0],
      [40, 50, 1],
      [200, 220, 2],
    ];

    function vizWithEndpoints(options: $TSFixMe = {}) {
      const { viz } = buildViz(DATA, options);
      viz.barEndpoints = endpoints;
      return viz;
    }

    it("returns the only overlapping bar", () => {
      expect(vizWithEndpoints().getDataIndexForSvgX(10)).toBe(0);
    });

    it("prefers the smallest bar when several overlap", () => {
      expect(vizWithEndpoints().getDataIndexForSvgX(45)).toBe(1);
    });

    it("still prefers the smallest bar when the narrow one comes first", () => {
      const viz = vizWithEndpoints();
      viz.barEndpoints = [
        [40, 50, 1],
        [0, 100, 0],
      ];
      expect(viz.getDataIndexForSvgX(45)).toBe(1);
    });

    it("includes the bar endpoints themselves", () => {
      const viz = vizWithEndpoints();
      expect(viz.getDataIndexForSvgX(0)).toBe(0);
      expect(viz.getDataIndexForSvgX(220)).toBe(2);
    });

    it("falls back to a bar within hoverBuffer when nothing overlaps", () => {
      expect(vizWithEndpoints().getDataIndexForSvgX(103)).toBe(0);
      expect(vizWithEndpoints().getDataIndexForSvgX(197)).toBe(2);
    });

    it("picks the closest bar when two are inside hoverBuffer", () => {
      const viz = vizWithEndpoints();
      viz.barEndpoints = [
        [0, 100, 0],
        [104, 120, 1],
      ];
      // 102 is 2 away from bar 0's end and 2 away from bar 1's start; the
      // first one seen wins the tie, and 103 is unambiguously closer to bar 1.
      expect(viz.getDataIndexForSvgX(102)).toBe(0);
      expect(viz.getDataIndexForSvgX(103)).toBe(1);
    });

    it("respects a widened hoverBuffer", () => {
      expect(vizWithEndpoints().getDataIndexForSvgX(150)).toBeNull();
      expect(
        vizWithEndpoints({ hoverBuffer: 100 }).getDataIndexForSvgX(150),
      ).toBe(0);
    });

    it("returns null when nothing is near", () => {
      expect(vizWithEndpoints().getDataIndexForSvgX(1000)).toBeNull();
    });
  });

  describe("highlightBar", () => {
    it("draws a darkened rect over the requested bar", () => {
      const { viz, container } = buildViz();
      viz.update();
      viz.highlightBar(1, true);
      const rects = container.querySelectorAll(".highlight-container rect");
      expect(rects).toHaveLength(1);
      expect(rects[0].getAttribute("fill")).not.toBe(DEFAULT_COLOR);
      expect(rects[0].getAttribute("height")).toBe("100");
    });

    it("replaces the previous highlight instead of stacking them", () => {
      const { viz, container } = buildViz();
      viz.update();
      viz.highlightBar(0, true);
      viz.highlightBar(1, true);
      expect(
        container.querySelectorAll(".highlight-container rect"),
      ).toHaveLength(1);
    });

    it("removes the highlight when asked not to highlight", () => {
      const { viz, container } = buildViz();
      viz.update();
      viz.highlightBar(0, true);
      viz.highlightBar(0, false);
      expect(
        container.querySelectorAll(".highlight-container rect"),
      ).toHaveLength(0);
    });

    it("draws nothing for a null bar index", () => {
      const { viz, container } = buildViz();
      viz.update();
      viz.highlightBar(null, true);
      expect(
        container.querySelectorAll(".highlight-container rect"),
      ).toHaveLength(0);
    });
  });

  describe("outlineBar", () => {
    it("draws a black-stroked rect inset by the outline buffer", () => {
      const { viz, container } = buildViz();
      viz.update();
      viz.outlineBar(0, true);
      const rects = container.querySelectorAll(".outline-container rect");
      expect(rects).toHaveLength(1);
      expect(rects[0].getAttribute("stroke")).toBe("#000");
      expect(rects[0].getAttribute("stroke-width")).toBe("2");
      expect(rects[0].getAttribute("y")).toBe("1");
      // Height is shrunk by the 1px buffer on both sides.
      expect(rects[0].getAttribute("height")).toBe("98");
    });

    it("removes the outline when asked not to highlight", () => {
      const { viz, container } = buildViz();
      viz.update();
      viz.outlineBar(0, true);
      viz.outlineBar(null, false);
      expect(
        container.querySelectorAll(".outline-container rect"),
      ).toHaveLength(0);
    });

    it("draws nothing for a null bar index", () => {
      const { viz, container } = buildViz();
      viz.update();
      viz.outlineBar(null, true);
      expect(
        container.querySelectorAll(".outline-container rect"),
      ).toHaveLength(0);
    });
  });

  describe("onMouseMove", () => {
    function hoverViz() {
      const onGenomeVizBarEnter = jest.fn();
      const onGenomeVizBarExit = jest.fn();
      const onGenomeVizBarHover = jest.fn();
      const { viz, container } = buildViz(DATA, {
        onGenomeVizBarEnter,
        onGenomeVizBarExit,
        onGenomeVizBarHover,
      });
      viz.update();
      viz.barEndpoints = [
        [0, 100, 0],
        [40, 50, 1],
      ];
      return {
        viz,
        container,
        onGenomeVizBarEnter,
        onGenomeVizBarExit,
        onGenomeVizBarHover,
      };
    }

    it("does nothing before update() has produced endpoints", () => {
      const onGenomeVizBarEnter = jest.fn();
      const { viz } = buildViz(DATA, { onGenomeVizBarEnter });
      viz.onMouseMove();
      expect(onGenomeVizBarEnter).not.toHaveBeenCalled();
    });

    it("does nothing when there are no bars", () => {
      const onGenomeVizBarEnter = jest.fn();
      const { viz } = buildViz(DATA, { onGenomeVizBarEnter });
      viz.barEndpoints = [];
      viz.onMouseMove();
      expect(onGenomeVizBarEnter).not.toHaveBeenCalled();
    });

    it("announces the entered bar, highlights it and reports the cursor", () => {
      const { viz, container, onGenomeVizBarEnter, onGenomeVizBarHover } =
        hoverViz();
      mockState.mouseX = 45;
      viz.onMouseMove();

      expect(onGenomeVizBarEnter).toHaveBeenCalledWith(1);
      expect(onGenomeVizBarHover).toHaveBeenCalledWith(111, 222);
      expect(viz.lastHoveredDataIndex).toBe(1);
      expect(
        container.querySelectorAll(".highlight-container rect"),
      ).toHaveLength(1);
    });

    it("does not re-announce a bar the cursor is still on", () => {
      const { viz, onGenomeVizBarEnter } = hoverViz();
      mockState.mouseX = 45;
      viz.onMouseMove();
      mockState.mouseX = 46;
      viz.onMouseMove();
      expect(onGenomeVizBarEnter).toHaveBeenCalledTimes(1);
    });

    it("announces the exit and clears the highlight on leaving every bar", () => {
      const { viz, container, onGenomeVizBarExit } = hoverViz();
      mockState.mouseX = 45;
      viz.onMouseMove();
      mockState.mouseX = 1000;
      viz.onMouseMove();

      expect(onGenomeVizBarExit).toHaveBeenCalledTimes(1);
      expect(viz.lastHoveredDataIndex).toBeNull();
      expect(
        container.querySelectorAll(".highlight-container rect"),
      ).toHaveLength(0);
    });

    it("does not announce an exit when no bar was hovered to begin with", () => {
      const { viz, onGenomeVizBarExit, onGenomeVizBarHover } = hoverViz();
      mockState.mouseX = 1000;
      viz.onMouseMove();
      expect(onGenomeVizBarExit).not.toHaveBeenCalled();
      expect(onGenomeVizBarHover).not.toHaveBeenCalled();
    });

    it("still highlights when no callbacks were supplied", () => {
      const { viz, container } = buildViz();
      viz.update();
      viz.barEndpoints = [[0, 100, 0]];
      mockState.mouseX = 10;
      viz.onMouseMove();
      expect(viz.lastHoveredDataIndex).toBe(0);
      expect(
        container.querySelectorAll(".highlight-container rect"),
      ).toHaveLength(1);
    });
  });

  describe("onMouseClick", () => {
    function clickViz() {
      const onGenomeVizBarClick = jest.fn();
      const { viz, container } = buildViz(DATA, { onGenomeVizBarClick });
      viz.update();
      viz.barEndpoints = [
        [0, 100, 0],
        [40, 50, 1],
      ];
      return { viz, container, onGenomeVizBarClick };
    }

    it("does nothing before update() has produced endpoints", () => {
      const onGenomeVizBarClick = jest.fn();
      const { viz } = buildViz(DATA, { onGenomeVizBarClick });
      viz.onMouseClick();
      expect(onGenomeVizBarClick).not.toHaveBeenCalled();
    });

    it("reports the clicked bar together with its screen box, and outlines it", () => {
      const { viz, container, onGenomeVizBarClick } = clickViz();
      mockState.mouseX = 45;
      viz.onMouseClick();

      expect(onGenomeVizBarClick).toHaveBeenCalledTimes(1);
      expect(onGenomeVizBarClick.mock.calls[0][0]).toBe(1);
      // jsdom has no layout, so the box is all zeros -- the point is that the
      // right/top of the *clicked* rect are what gets forwarded.
      expect(onGenomeVizBarClick.mock.calls[0]).toHaveLength(3);
      expect(
        container.querySelectorAll(".outline-container rect"),
      ).toHaveLength(1);
    });

    it("reports a null selection and clears the outline when clicking empty space", () => {
      const { viz, container, onGenomeVizBarClick } = clickViz();
      mockState.mouseX = 45;
      viz.onMouseClick();
      mockState.mouseX = 1000;
      viz.onMouseClick();

      expect(onGenomeVizBarClick).toHaveBeenLastCalledWith(null);
      expect(
        container.querySelectorAll(".outline-container rect"),
      ).toHaveLength(0);
    });

    it("is inert when no click callback was supplied", () => {
      const { viz, container } = buildViz();
      viz.update();
      viz.barEndpoints = [[0, 100, 0]];
      mockState.mouseX = 10;
      viz.onMouseClick();
      expect(
        container.querySelectorAll(".outline-container rect"),
      ).toHaveLength(0);
    });
  });

  describe("onMouseLeave", () => {
    it("announces the exit and clears the highlight", () => {
      const onGenomeVizBarExit = jest.fn();
      const { viz, container } = buildViz(DATA, { onGenomeVizBarExit });
      viz.update();
      viz.barEndpoints = [[0, 100, 0]];
      mockState.mouseX = 10;
      viz.onMouseMove();
      expect(viz.lastHoveredDataIndex).toBe(0);

      viz.onMouseLeave();
      expect(onGenomeVizBarExit).toHaveBeenCalled();
      expect(viz.lastHoveredDataIndex).toBeNull();
      expect(
        container.querySelectorAll(".highlight-container rect"),
      ).toHaveLength(0);
    });

    it("clears the hover state even without an exit callback", () => {
      const { viz } = buildViz();
      viz.update();
      viz.barEndpoints = [[0, 100, 0]];
      mockState.mouseX = 10;
      viz.onMouseMove();
      viz.onMouseLeave();
      expect(viz.lastHoveredDataIndex).toBeNull();
    });
  });
});

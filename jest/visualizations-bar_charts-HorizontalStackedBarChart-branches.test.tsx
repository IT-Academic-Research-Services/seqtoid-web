// Coverage: app/assets/src/components/visualizations/bar_charts/
//   HorizontalStackedBarChart.tsx -- the branches the existing
//   visualizations-bar_charts-HorizontalStackedBarChart spec cannot reach.
//
// That spec runs in a jsdom where every element measures 0x0, so the chart
// always takes the "nothing needs truncating" path, the bars all collapse to
// the 1px minimum, and nothing is ever hovered. Here we give jsdom a real
// measurement model -- clientWidth/clientHeight are stubbed on
// HTMLElement.prototype so label divs report a width derived from their text
// and the chart container reports a fixed width -- which unlocks:
//
//   * measureWidths' truncation branch, including the per-label
//     `labelWidth > yAxisWidth` decision taken BOTH ways in one pass, and the
//     `truncatedLabels.length > 0` selection of truncated over raw labels;
//   * the mouseOverBar state machine (empty-space enter/leave), which gates
//     the extra "full bar" rect in the invisible stack;
//   * the per-stack-piece hover callbacks;
//   * options.x.gridVisible both ways, and renderXGrid's normalize/plain
//     tick-count branch;
//   * componentDidUpdate's `scaleChanged` path (normalize prop flipping),
//     which is distinct from the redrawNeeded path;
//   * handleWindowResize and componentWillUnmount's listener teardown.
import { fireEvent, render, screen } from "@testing-library/react";
import HorizontalStackedBarChart from "~/components/visualizations/bar_charts/HorizontalStackedBarChart";

/* eslint-disable @typescript-eslint/no-explicit-any */

const mockAxis: { x: any; y: any } = { x: null, y: null };

jest.mock("~/components/visualizations/bar_charts/XAxis", () => ({
  __esModule: true,
  default: (props: any) => {
    mockAxis.x = props;
    return require("react").createElement("div", { "data-testid": "x-axis" });
  },
}));

jest.mock("~/components/visualizations/bar_charts/YAxis", () => ({
  __esModule: true,
  default: (props: any) => {
    mockAxis.y = props;
    return require("react").createElement("div", { "data-testid": "y-axis" });
  },
}));

// Width the chart container reports. Mutable so a test can simulate a resize.
let containerWidth = 500;

const LONG = "Alphabetical Item Name"; // 22 chars -> 220px under the stub
const SHORT = "Beta"; //  4 chars ->  40px

const originalWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientWidth",
);
const originalHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientHeight",
);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      // The chart root (both the baseline and the drawn render use the same
      // className) is the element whose width drives every other dimension.
      if (this.classList && this.classList.contains("hsbc-root")) {
        return containerWidth;
      }
      return (this.textContent || "").length * 10;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 12,
  });
});

afterAll(() => {
  if (originalWidth) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", originalWidth);
  }
  if (originalHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientHeight",
      originalHeight,
    );
  }
});

const DATA = () => [
  { item: LONG, monday: 10, tuesday: 7, total: 17 },
  { item: SHORT, monday: 3, tuesday: 5, total: 8 },
];
const KEYS = ["item", "monday", "tuesday"];

const makeEvents = () => ({
  onYAxisLabelClick: jest.fn(),
  onYAxisLabelEnter: jest.fn(),
  onBarStackEnter: jest.fn(),
  onBarEmptySpaceEnter: jest.fn(),
  onChartHover: jest.fn(),
  onChartElementExit: jest.fn(),
});

function renderChart(overrides: Record<string, any> = {}) {
  const events = overrides.events || makeEvents();
  const utils = render(
    <HorizontalStackedBarChart
      className="hsbc-root"
      data={DATA()}
      keys={KEYS}
      yAxisKey="item"
      events={events}
      {...overrides}
    />,
  );
  return { events, ...utils };
}

const svgRoot = () => screen.getByTestId("read-lost-bar");
const invisibleGroup = () =>
  svgRoot().querySelector('g[fill-opacity="0"]') as SVGGElement;
const visibleRects = () =>
  Array.from(svgRoot().querySelectorAll("g[fill] rect"));

beforeEach(() => {
  mockAxis.x = null;
  mockAxis.y = null;
  containerWidth = 500;
});

describe("HorizontalStackedBarChart label truncation", () => {
  it("truncates only the labels that overflow the y-axis allowance", () => {
    renderChart();
    // canvas = 500*0.98 - 40 = 450; allowance = 30% = 135px.
    // The 220px label is clipped and ellipsised; the 40px one is left alone.
    expect(mockAxis.y.labels).toEqual(["Alphabetical It...", SHORT]);
    expect(mockAxis.y.labels[0].endsWith("...")).toBe(true);
  });

  it("passes the raw domain through untouched when every label fits", () => {
    // A much wider container leaves the 220px label inside the 30% allowance.
    containerWidth = 4000;
    renderChart();
    expect(mockAxis.y.labels).toEqual([LONG, SHORT]);
    expect(mockAxis.y.labels[0]).not.toContain("...");
  });

  it("reserves y-axis width for the labels and gives the rest to the bars", () => {
    renderChart();
    // yAxisWidth = 135 + xTextWidth/2 (40/2) = 155.
    expect(mockAxis.y.width).toBe(155);
    expect(mockAxis.x.marginLeft).toBe(155);
    // xAxisHeight = tickSize(6) * 1 + xTextHeight(12).
    expect(mockAxis.x.height).toBe(18);
    // barCanvasHeight = 2 rows * (height 22 + padding 6).
    expect(mockAxis.y.height).toBe(56);
  });
});

describe("HorizontalStackedBarChart x grid", () => {
  it("draws grid lines spanning the bar canvas when gridVisible is true", () => {
    renderChart({ options: { x: { gridVisible: true } } });
    const paths = svgRoot().querySelectorAll("path");
    expect(paths.length).toBeGreaterThan(0);
    // Every grid line runs the full height of the bar canvas.
    paths.forEach(p => expect(p.getAttribute("d")).toContain("v 56"));
  });

  it("draws no grid lines when gridVisible is false", () => {
    renderChart({ options: { x: { gridVisible: false } } });
    expect(svgRoot().querySelectorAll("path")).toHaveLength(0);
  });
});

describe("HorizontalStackedBarChart normalize mode", () => {
  it("scales x to the raw totals when not normalized, leaving 10% headroom", () => {
    renderChart();
    // max total 17 -> [0, 18.7] -> nice() -> [0, 20].
    expect(mockAxis.x.x.domain()[1]).toBeGreaterThan(17);
    // The invisible "empty space" stack only exists in un-normalized mode.
    expect(invisibleGroup()).not.toBeNull();
  });

  it("scales x exactly to 100 and drops the invisible stack when normalized", () => {
    renderChart({ normalize: true });
    expect(mockAxis.x.x.domain()).toEqual([0, 100]);
    expect(invisibleGroup()).toBeNull();
  });

  it("recomputes the scale when the normalize prop flips after mount", () => {
    const events = makeEvents();
    const { rerender } = renderChart({ events });
    expect(mockAxis.x.x.domain()).toEqual([0, 20]);
    expect(invisibleGroup()).not.toBeNull();

    rerender(
      <HorizontalStackedBarChart
        className="hsbc-root"
        data={DATA()}
        keys={KEYS}
        yAxisKey="item"
        events={events}
        normalize={true}
      />,
    );

    // componentDidUpdate's scaleChanged branch re-ran updateChartDimensions.
    expect(mockAxis.x.x.domain()).toEqual([0, 100]);
    expect(invisibleGroup()).toBeNull();
  });
});

describe("HorizontalStackedBarChart bar hover", () => {
  it("reports the key and value of the stack piece under the cursor", () => {
    const { events } = renderChart();
    const rects = visibleRects();
    // Two data keys x two rows.
    expect(rects).toHaveLength(4);

    fireEvent.mouseEnter(rects[0]);
    expect(events.onBarStackEnter).toHaveBeenCalledWith("monday", 10);

    fireEvent.mouseLeave(rects[0]);
    expect(events.onChartElementExit).toHaveBeenCalled();

    fireEvent.mouseEnter(rects[3]);
    expect(events.onBarStackEnter).toHaveBeenLastCalledWith("tuesday", 5);
  });

  it("adds a full-bar overlay for the hovered row and removes it on leave", () => {
    const { events } = renderChart();
    // One empty-space rect per row, no overlay yet.
    expect(invisibleGroup().querySelectorAll("rect")).toHaveLength(2);

    const emptySpace = invisibleGroup().querySelectorAll("rect")[1];
    fireEvent.mouseEnter(emptySpace);

    expect(events.onBarEmptySpaceEnter).toHaveBeenCalledWith({
      item: SHORT,
      monday: 3,
      tuesday: 5,
      total: 8,
    });
    // The hovered row now also renders its full-bar rect.
    expect(invisibleGroup().querySelectorAll("rect")).toHaveLength(3);

    fireEvent.mouseLeave(invisibleGroup().querySelectorAll("rect")[1]);
    expect(events.onChartElementExit).toHaveBeenCalled();
    expect(invisibleGroup().querySelectorAll("rect")).toHaveLength(2);
  });

  it("keeps every bar at least one pixel wide when the canvas collapses", () => {
    containerWidth = 0;
    renderChart();
    const widths = visibleRects().map(r => Number(r.getAttribute("width")));
    expect(widths.length).toBeGreaterThan(0);
    widths.forEach(w => expect(w).toBeGreaterThanOrEqual(1));
  });
});

describe("HorizontalStackedBarChart resize handling", () => {
  it("remeasures the chart when the window resizes", () => {
    renderChart();
    expect(mockAxis.x.width).toBe(490);

    containerWidth = 1000;
    fireEvent(window, new Event("resize"));

    expect(mockAxis.x.width).toBe(980);
  });

  it("removes its resize listener on unmount", () => {
    const removeSpy = jest.spyOn(window, "removeEventListener");
    const { unmount } = renderChart();
    unmount();
    expect(removeSpy.mock.calls.some(([event]) => event === "resize")).toBe(
      true,
    );
    removeSpy.mockRestore();
  });
});

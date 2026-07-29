// Branch coverage: app/assets/src/components/visualizations/Histogram.ts
//
// Companion to Histogram.test.ts and Histogram-branch-paths.test.ts. Those
// cover construction and the option-driven ternaries; this one walks the two
// handler guards that are only reachable when the *optional* callbacks and
// colors are absent:
//
//   * onBarMouseUp -- the `if (this.options.hoverColors)` else path.
//   * onMouseMove  -- the "cursor left every bar" arm, with and without an
//                     onHistogramBarExit callback.
//
// d3's `mouse()` reads the live pointer position off an SVG element, which
// jsdom cannot compute (no getScreenCTM / createSVGPoint). Stubbing just that
// one export lets us drive the hover state deterministically while the rest of
// d3-selection stays real, so the chart is still built by the real code.
jest.mock("d3-selection", () => {
  const actual = jest.requireActual("d3-selection");
  return {
    ...actual,
    mouse: (...args: unknown[]) => mockMouse(...args),
  };
});

import Histogram from "~/components/visualizations/Histogram";

const mockMouse = jest.fn((..._args: unknown[]): number[] => [0, 0]);

function build(data: unknown, options: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 500 });
  Object.defineProperty(container, "clientHeight", { value: 300 });
  document.body.appendChild(container);
  const histogram = new Histogram(container, data, {
    showStatistics: false,
    ...options,
  });
  histogram.update();
  return { container, histogram };
}

beforeEach(() => {
  document.body.innerHTML = "";
  mockMouse.mockReset();
  mockMouse.mockReturnValue([0, 0]);
});

const DATA = [[1, 2, 3, 4, 5]];

describe("Histogram.onBarMouseUp", () => {
  it("recolors the bar with the hover color when hoverColors is set", () => {
    const { container, histogram } = build(DATA, {
      hoverColors: ["#ff0000"],
    });

    const rect = container.querySelector("g.bar-0 rect.rect-0");
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute("fill")).toBeNull();

    histogram.onBarMouseUp(0, 0);

    expect(rect?.getAttribute("fill")).toBe("#ff0000");
  });

  it("leaves the bar untouched when no hoverColors are configured", () => {
    const { container, histogram } = build(DATA);

    const rect = container.querySelector("g.bar-0 rect.rect-0");
    expect(rect).not.toBeNull();

    histogram.onBarMouseUp(0, 0);

    // The group carries the series color; the rect itself must stay unstyled.
    expect(rect?.getAttribute("fill")).toBeNull();
  });
});

describe("Histogram.onMouseMove leaving the last hovered bar", () => {
  const hoverThenLeave = (options: Record<string, unknown> = {}) => {
    const { histogram } = build(DATA, options);
    const centers: number[] = histogram.sortedBarCenters;
    expect(centers.length).toBeGreaterThan(0);

    // Park the cursor on the first bar center so lastHoveredBarX is recorded.
    mockMouse.mockReturnValue([centers[0], 5]);
    histogram.onMouseMove();
    expect(histogram.lastHoveredBarX).toBe(centers[0]);

    // Then move far past the last bar: no bar is within hoverBuffer, so the
    // exit arm runs.
    mockMouse.mockReturnValue([centers[centers.length - 1] + 10000, 5]);
    histogram.onMouseMove();

    return histogram;
  };

  it("clears the hovered bar without an onHistogramBarExit callback", () => {
    const histogram = hoverThenLeave();
    expect(histogram.lastHoveredBarX).toBeNull();
  });

  it("calls onHistogramBarExit when one is provided", () => {
    const onHistogramBarExit = jest.fn();
    const histogram = hoverThenLeave({ onHistogramBarExit });

    expect(onHistogramBarExit).toHaveBeenCalledTimes(1);
    expect(histogram.lastHoveredBarX).toBeNull();
  });

  it("does nothing when there are no bars to hover", () => {
    const { histogram } = build(DATA);
    histogram.sortedBarCenters = [];
    histogram.lastHoveredBarX = 42;

    histogram.onMouseMove();

    // The early return leaves the previous hover state alone.
    expect(histogram.lastHoveredBarX).toBe(42);
    expect(mockMouse).not.toHaveBeenCalled();
  });
});

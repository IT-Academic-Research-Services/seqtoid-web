// CZID-586 (#586) frontend coverage wave 4 -- D3 visualization classes.
//
// Histogram is a plain class (no React), so it can be driven directly rather
// than snapshotted: construct it against a jsdom container, call the public
// methods, and assert on the values they return and the SVG they emit.
//
// The tests below deliberately favour pure logic (option merging, data parsing,
// domain selection, binning, bar-width math, colour selection, the symlog tick
// hack) over poking at D3 internals. Where the rendered output is asserted, it
// is asserted on outcomes a reader can reason about: how many bars exist, which
// group they are in, what fill they carry.
//
// jsdom does not implement SVG layout, so nothing here depends on getBBox or on
// real geometry. `mouse()` and `event` from d3-selection are the one exception:
// they read a live browser event, so they are mocked (see below) in order to
// drive the hover/highlight logic, which is otherwise unreachable.
import { HISTOGRAM_SCALE } from "~/components/visualizations/Histogram";

// d3-selection's `event` is a live module binding set by D3 during dispatch, and
// `mouse()` needs a real MouseEvent + SVG geometry. Both are stubbed so the
// hover code paths can be exercised deterministically. Everything else in
// d3-selection (select, selectAll, ...) is the real implementation.
const mockState: { mouseX: number; event: unknown } = {
  mouseX: 0,
  event: { clientX: 0, clientY: 0, stopPropagation: jest.fn() },
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

import Histogram from "~/components/visualizations/Histogram";

// Give the container a real size; jsdom reports clientWidth/clientHeight as 0,
// which would silently send the constructor down its 800x400 fallback.
function makeContainer(width = 500, height = 300) {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: width });
  Object.defineProperty(container, "clientHeight", { value: height });
  document.body.appendChild(container);
  return container;
}

function build(data: unknown, options: Record<string, unknown> = {}) {
  const container = makeContainer();
  const histogram = new Histogram(container, data, options);
  return { container, histogram };
}

beforeEach(() => {
  document.body.innerHTML = "";
  mockState.mouseX = 0;
  mockState.event = { clientX: 0, clientY: 0, stopPropagation: jest.fn() };
});

describe("Histogram.parseData", () => {
  it("wraps a flat array into a single series", () => {
    const { histogram } = build([1, 2, 3]);
    expect(histogram.data).toEqual([[1, 2, 3]]);
  });

  it("passes an array of series through untouched", () => {
    const series = [
      [1, 2],
      [3, 4],
    ];
    const { histogram } = build(series);
    expect(histogram.data).toEqual(series);
  });

  it("returns null for a non-array input", () => {
    const { histogram } = build("not data" as unknown);
    expect(histogram.data).toBeNull();
  });

  it("returns null for null input", () => {
    const { histogram } = build(null);
    expect(histogram.data).toBeNull();
  });
});

describe("Histogram constructor", () => {
  it("applies default options", () => {
    const { histogram } = build([1, 2, 3]);
    expect(histogram.options.barOpacity).toBe(0.8);
    expect(histogram.options.colormap).toBe("viridis");
    expect(histogram.options.showStatistics).toBe(true);
    expect(histogram.options.hoverBuffer).toBe(5);
    expect(histogram.options.xScaleType).toBe(HISTOGRAM_SCALE.LINEAR);
    expect(histogram.options.yScaleType).toBe(HISTOGRAM_SCALE.LINEAR);
  });

  it("lets caller options win over the defaults", () => {
    const { histogram } = build([1, 2, 3], {
      barOpacity: 0.25,
      showStatistics: false,
      xScaleType: HISTOGRAM_SCALE.LOG,
    });
    expect(histogram.options.barOpacity).toBe(0.25);
    expect(histogram.options.showStatistics).toBe(false);
    expect(histogram.options.xScaleType).toBe(HISTOGRAM_SCALE.LOG);
  });

  it("uses the default margins when none are given", () => {
    const { histogram } = build([1, 2, 3]);
    expect(histogram.margins).toEqual({
      top: 20,
      right: 40,
      bottom: 40,
      left: 40,
    });
  });

  it("uses caller margins when given", () => {
    const margins = { top: 1, right: 2, bottom: 3, left: 4 };
    const { histogram } = build([1, 2, 3], { margins });
    expect(histogram.margins).toEqual(margins);
  });

  it("takes its size from the container", () => {
    const { histogram } = build([1, 2, 3]);
    expect(histogram.size).toEqual({ width: 500, height: 300 });
  });

  it("falls back to 800x400 when the container has no measured size", () => {
    // A detached div reports clientWidth/clientHeight of 0.
    const container = document.createElement("div");
    const histogram = new Histogram(container, [1, 2, 3], {});
    expect(histogram.size).toEqual({ width: 800, height: 400 });
  });

  it("appends a single sized svg to the container", () => {
    const { container } = build([1, 2, 3]);
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(1);
    expect(svgs[0].getAttribute("width")).toBe("500");
    expect(svgs[0].getAttribute("height")).toBe("300");
  });

  it("removes a previously rendered chart instead of stacking svgs", () => {
    const container = makeContainer();
    new Histogram(container, [1, 2, 3], {});
    new Histogram(container, [4, 5, 6], {});
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("starts with no hovered bar", () => {
    const { histogram } = build([1, 2, 3]);
    expect(histogram.lastHoveredBarX).toBeNull();
  });
});

describe("Histogram.getXDomain", () => {
  it("returns an explicit domain option verbatim", () => {
    const { histogram } = build([1, 2, 3], { domain: [-10, 10] });
    expect(histogram.getXDomain()).toEqual([-10, 10]);
  });

  it("spans the min and max across all series on a linear scale", () => {
    const { histogram } = build([
      [5, 9],
      [2, 30],
    ]);
    expect(histogram.getXDomain()).toEqual([2, 30]);
  });

  it("pins the lower bound to 1 on a log scale", () => {
    // log(0) is -Infinity, so the class hard-codes a min of 1.
    const { histogram } = build([0, 5, 50], {
      xScaleType: HISTOGRAM_SCALE.LOG,
    });
    expect(histogram.getXDomain()).toEqual([1, 50]);
  });

  it("pins the lower bound to 0 on a symlog scale", () => {
    const { histogram } = build([3, 5, 50], {
      xScaleType: HISTOGRAM_SCALE.SYM_LOG,
    });
    expect(histogram.getXDomain()).toEqual([0, 50]);
  });

  it("widens the domain so reference lines still fit", () => {
    // The data alone spans 5..9, but a ref value at 100 must remain on-chart.
    const { histogram } = build([[5, 9]], {
      refValues: [{ name: "ref", values: ["100"] }],
    });
    expect(histogram.getXDomain()).toEqual([5, 100]);
  });

  it("widens the domain downwards for a low reference line", () => {
    const { histogram } = build([[5, 9]], {
      refValues: [{ name: "ref", values: ["-3"] }],
    });
    expect(histogram.getXDomain()).toEqual([-3, 9]);
  });

  it("handles a single-datum series (degenerate range)", () => {
    const { histogram } = build([7]);
    expect(histogram.getXDomain()).toEqual([7, 7]);
  });

  it("returns undefined bounds for an empty series", () => {
    // d3's extent() yields [undefined, undefined] with nothing to measure.
    const { histogram } = build([[]]);
    expect(histogram.getXDomain()).toEqual([undefined, undefined]);
  });
});

describe("Histogram.getBins", () => {
  it("returns the data untouched when skipBins is set", () => {
    const preBinned = [[{ x0: 0, length: 3 }]];
    const { histogram } = build(preBinned, { skipBins: true });
    expect(histogram.getBins(null)).toBe(histogram.data);
  });

  it("bins each series independently over the x domain", () => {
    const { histogram } = build([
      [1, 1, 2],
      [8, 9],
    ]);
    const x = { domain: () => [0, 10], ticks: () => [0, 5, 10] };
    const bins = histogram.getBins(x);

    expect(bins).toHaveLength(2);
    // Series 0: three values, all below 5. Series 1: two values, both above 5.
    expect(bins[0].reduce((n: number, b: unknown[]) => n + b.length, 0)).toBe(
      3,
    );
    expect(bins[1].reduce((n: number, b: unknown[]) => n + b.length, 0)).toBe(
      2,
    );
    expect(bins[0][0].x0).toBe(0);
  });

  it("produces empty bins for an empty series rather than throwing", () => {
    const { histogram } = build([[]]);
    const x = { domain: () => [0, 10], ticks: () => [0, 5, 10] };
    const bins = histogram.getBins(x);
    expect(bins[0].every((b: unknown[]) => b.length === 0)).toBe(true);
  });
});

describe("Histogram.getBarWidth", () => {
  it("uses half the scaled bin span on a log scale", () => {
    const { histogram } = build([1, 10], { xScaleType: HISTOGRAM_SCALE.LOG });
    const x = (v: number) => v * 2;
    expect(histogram.getBarWidth(x, { x0: 10, x1: 30 })).toBe((60 - 20) / 2);
  });

  it("divides the plot area by an explicit numBins", () => {
    // width 500 - right 40 - left 40 = 420 usable; 420 / 4 = 105.
    const { histogram } = build([1, 2, 3], { numBins: 4 });
    const x = { ticks: () => [] };
    expect(histogram.getBarWidth(x, {})).toBe(105);
  });

  it("subtracts a pixel per bar when spacedBars is set", () => {
    const { histogram } = build([1, 2, 3], { numBins: 4, spacedBars: true });
    const x = { ticks: () => [] };
    expect(histogram.getBarWidth(x, {})).toBe(104);
  });

  it("derives numBins from the tick count when not given", () => {
    // 5 ticks -> 4 bins -> 420 / 4 = 105.
    const { histogram } = build([1, 2, 3]);
    const x = { ticks: () => [0, 1, 2, 3, 4] };
    expect(histogram.getBarWidth(x, {})).toBe(105);
  });

  it("never derives fewer than 2 bins from the tick count", () => {
    // 2 ticks would imply 1 bin; the max([n-1, 2]) floor keeps it at 2.
    const { histogram } = build([1, 2, 3]);
    const x = { ticks: () => [0, 1] };
    expect(histogram.getBarWidth(x, {})).toBe(210);
  });

  it("derives numBins from the longest pre-binned series when skipBins is set", () => {
    const { histogram } = build(
      [
        [1, 2],
        [1, 2, 3, 4, 5, 6],
      ],
      { skipBins: true },
    );
    // Longest series has 6 entries -> 420 / 6 = 70.
    expect(histogram.getBarWidth(null, {})).toBe(70);
  });
});

describe("Histogram.getColors", () => {
  it("returns explicit colors when provided", () => {
    const colors = ["#111111", "#222222"];
    const { histogram } = build([1, 2, 3], { colors });
    expect(histogram.getColors()).toBe(colors);
  });

  it("generates one categorical color per series plus one", () => {
    const { histogram } = build([
      [1, 2],
      [3, 4],
    ]);
    // 2 series -> 3 colors (the class asks for data.length + 1).
    expect(histogram.getColors()).toHaveLength(3);
  });
});

describe("Histogram.getBarOpacity", () => {
  it("reports the configured bar opacity", () => {
    const { histogram } = build([1, 2, 3], { barOpacity: 0.42 });
    expect(histogram.getBarOpacity()).toBe(0.42);
  });
});

describe("Histogram.fixSymLogScaleTicks", () => {
  it("prepends 0 to the log ticks", () => {
    const { histogram } = build([1, 2, 3]);
    const scale = {
      domain: jest.fn(function (this: unknown, d?: number[]) {
        if (d) return this;
        return [0, 100];
      }),
      nice: jest.fn(),
      ticks: () => [],
    };
    // domain() must be chainable with nice() for the reset inside ticks().
    scale.domain = jest.fn(function (d?: number[]) {
      if (d) return { nice: () => undefined };
      return [0, 100];
    }) as never;

    histogram.fixSymLogScaleTicks(scale);
    const ticks = scale.ticks(5);
    expect(ticks[0]).toBe(0);
  });

  it("trims log ticks that overshoot the domain", () => {
    const { histogram } = build([1, 2, 3]);
    let currentDomain = [0, 4];
    const scale = {
      domain: jest.fn((d?: number[]) => {
        if (d) {
          currentDomain = d;
          return { nice: () => undefined };
        }
        return currentDomain;
      }),
      ticks: () => [],
    };

    histogram.fixSymLogScaleTicks(scale);
    const ticks = scale.ticks(2);

    // The underlying log scale over [1, 4] emits 1..10, which would overshoot
    // the chart. Everything past the first tick >= the domain max is dropped,
    // and 0 is prepended for the symlog origin.
    expect(ticks).toEqual([0, 1, 2, 3, 4]);
  });

  it("resets the domain to span 0 through the last surviving tick", () => {
    const { histogram } = build([1, 2, 3]);
    let currentDomain = [0, 4];
    const scale = {
      domain: jest.fn((d?: number[]) => {
        if (d) {
          currentDomain = d;
          return { nice: () => undefined };
        }
        return currentDomain;
      }),
      ticks: () => [],
    };

    histogram.fixSymLogScaleTicks(scale);
    scale.ticks(2);

    // Ticks stop at 4, and the domain max is also 4, so the domain becomes [0, 4].
    expect(currentDomain).toEqual([0, 4]);
  });
});

describe("Histogram.update rendering", () => {
  it("does nothing when the data failed to parse", () => {
    const { container, histogram } = build(null);
    histogram.update();
    expect(container.querySelectorAll("rect")).toHaveLength(0);
  });

  it("renders one bar group per series", () => {
    const { container, histogram } = build([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    histogram.update();
    expect(container.querySelectorAll("g.bar-0")).toHaveLength(1);
    expect(container.querySelectorAll("g.bar-1")).toHaveLength(1);
  });

  it("renders a rect per bin and records their centers", () => {
    const { container, histogram } = build([[1, 2, 3, 4, 5]]);
    histogram.update();

    const bars = container.querySelectorAll("g.bar-0 rect");
    expect(bars.length).toBeGreaterThan(0);
    expect(histogram.bins[0].length).toBe(bars.length);
    // Every bar center maps back to a [seriesIndex, barIndex] pair.
    expect(Object.keys(histogram.barCentersToIndices)).toHaveLength(
      bars.length,
    );
    expect(histogram.sortedBarCenters).toHaveLength(bars.length);
  });

  it("keeps sortedBarCenters in ascending order", () => {
    const { histogram } = build([[1, 2, 3, 4, 5]]);
    histogram.update();
    const centers = histogram.sortedBarCenters;
    const ascending = [...centers].sort((a: number, b: number) => a - b);
    expect(centers).toEqual(ascending);
  });

  it("applies the configured bar opacity to every bar", () => {
    const { container, histogram } = build([[1, 2, 3, 4, 5]], {
      barOpacity: 0.5,
    });
    histogram.update();
    const bars = Array.from(container.querySelectorAll("g.bar-0 rect"));
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.every(bar => (bar as SVGElement).style.opacity === "0.5")).toBe(
      true,
    );
  });

  it("draws the mean/deviation statistics overlay by default", () => {
    const { container, histogram } = build([[1, 2, 3, 4, 5]]);
    histogram.update();
    // The stats overlay is a line at the mean plus a translucent rect.
    expect(container.querySelectorAll("rect[fill-opacity='0.2']").length).toBe(
      1,
    );
  });

  it("omits the statistics overlay when showStatistics is false", () => {
    const { container, histogram } = build([[1, 2, 3, 4, 5]], {
      showStatistics: false,
    });
    histogram.update();
    expect(container.querySelectorAll("rect[fill-opacity='0.2']")).toHaveLength(
      0,
    );
  });

  it("draws a dashed line and a label per reference value", () => {
    const { container, histogram } = build([[1, 2, 3, 4, 5]], {
      refValues: [
        { name: "cutoff", values: ["3"] },
        { name: "target", values: ["4"] },
      ],
    });
    histogram.update();

    const refs = container.querySelector("g.refs");
    expect(refs).not.toBeNull();
    expect(refs?.querySelectorAll("line")).toHaveLength(2);
    const labels = Array.from(refs?.querySelectorAll("text") ?? []).map(
      t => t.textContent,
    );
    expect(labels).toEqual(["cutoff", "target"]);
  });

  it("renders no refs group when there are no reference values", () => {
    const { container, histogram } = build([[1, 2, 3, 4, 5]]);
    histogram.update();
    expect(container.querySelector("g.refs")).toBeNull();
  });

  it("renders a legend entry per series name", () => {
    const { container, histogram } = build(
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      { seriesNames: ["first", "second"] },
    );
    histogram.update();

    const legend = container.querySelector("g.histogram__legend");
    expect(legend).not.toBeNull();
    expect(legend?.querySelectorAll("rect")).toHaveLength(2);
    expect(
      Array.from(legend?.querySelectorAll("text") ?? []).map(
        t => t.textContent,
      ),
    ).toEqual(["first", "second"]);
  });

  it("renders no legend without seriesNames", () => {
    const { container, histogram } = build([[1, 2, 3]]);
    histogram.update();
    expect(container.querySelector("g.histogram__legend")).toBeNull();
  });

  it("renders the x and y axis labels", () => {
    const { container, histogram } = build([[1, 2, 3]], {
      labelX: "reads",
      labelY: "samples",
      labelXSubtext: "per million",
    });
    histogram.update();

    const texts = Array.from(container.querySelectorAll("text")).map(
      t => t.textContent,
    );
    expect(texts).toContain("reads");
    expect(texts).toContain("samples");
    expect(texts).toContain("per million");
  });

  it("omits the x-axis subtext when not configured", () => {
    const { container, histogram } = build([[1, 2, 3]], { labelX: "reads" });
    histogram.update();
    const texts = Array.from(container.querySelectorAll("text")).map(
      t => t.textContent,
    );
    expect(texts).toContain("reads");
    expect(texts).not.toContain("per million");
  });

  it("formats x-axis ticks through xTickFormat", () => {
    const xTickFormat = jest.fn((d: number) => `<${d}>`);
    const { histogram } = build([[1, 2, 3]], { xTickFormat });
    histogram.update();
    expect(xTickFormat).toHaveBeenCalled();
  });

  it("honours explicit tickValues", () => {
    const { histogram } = build([[1, 2, 3]], { tickValues: [1, 2, 3] });
    histogram.update();
    // With tickValues set, .nice() is skipped so the domain is the raw extent.
    expect(histogram.getXDomain()).toEqual([1, 3]);
  });

  it("formats y-axis ticks through yTickFormat", () => {
    const { container, histogram } = build([[1, 2, 3]], {
      yTickFormat: (d: number) => `y${d}`,
    });
    histogram.update();
    const texts = Array.from(container.querySelectorAll("text")).map(
      t => t.textContent,
    );
    expect(texts.some(t => t?.startsWith("y"))).toBe(true);
  });

  it("drops y-axis ticks rejected by yTickFilter", () => {
    const { container, histogram } = build([[1, 2, 3, 4, 5]], {
      // Keep only even tick values.
      yTickFilter: (d: number) => d % 2 === 0,
      yTickFormat: (d: number) => `y${d}`,
    });
    histogram.update();

    const yTicks = Array.from(container.querySelectorAll("text"))
      .map(t => t.textContent)
      .filter(t => t?.startsWith("y"))
      .map(t => Number(t?.slice(1)));

    expect(yTicks.length).toBeGreaterThan(0);
    expect(yTicks.every(v => v % 2 === 0)).toBe(true);
  });

  it("respects numTicksY when filtering y ticks", () => {
    const { container, histogram } = build([[1, 2, 3, 4, 5]], {
      numTicksY: 2,
      yTickFilter: () => true,
      yTickFormat: (d: number) => `y${d}`,
    });
    histogram.update();
    const yTicks = Array.from(container.querySelectorAll("text")).filter(t =>
      t.textContent?.startsWith("y"),
    );
    // d3 treats the tick count as a hint, but it must stay in that ballpark
    // rather than falling back to the default ~10.
    expect(yTicks.length).toBeGreaterThan(0);
    expect(yTicks.length).toBeLessThanOrEqual(5);
  });

  it("stretches y tick lines across the plot when showGridlines is set", () => {
    const { container, histogram } = build([[1, 2, 3]], {
      showGridlines: true,
    });
    histogram.update();

    const gridlines = Array.from(container.querySelectorAll("line")).filter(
      l => l.getAttribute("x1") === "-6",
    );
    expect(gridlines.length).toBeGreaterThan(0);
    // 500 - 40 (left) - 40 (right) = 420.
    expect(gridlines.every(l => l.getAttribute("x2") === "420")).toBe(true);
  });

  it("adds a hover rect over the plot area when hoverBuffer is positive", () => {
    const { container, histogram } = build([[1, 2, 3]], {
      hoverBuffer: 5,
      showStatistics: false,
    });
    histogram.update();
    // The hover rect is the only rect offset to the plot origin (left, top),
    // and it spans the full plot area: 500-40-40 wide by 300-20-40 tall.
    const hoverRect = Array.from(container.querySelectorAll("rect")).find(
      r => r.getAttribute("transform") === "translate(40, 20)",
    );
    expect(hoverRect).toBeDefined();
    expect(hoverRect?.getAttribute("width")).toBe("420");
    expect(hoverRect?.getAttribute("height")).toBe("240");
  });

  it("adds no hover rect when hoverBuffer is 0", () => {
    const { container, histogram } = build([[1, 2, 3]], {
      hoverBuffer: 0,
      showStatistics: false,
    });
    histogram.update();
    const hoverRect = Array.from(container.querySelectorAll("rect")).find(
      r => r.getAttribute("transform") === "translate(40, 20)",
    );
    expect(hoverRect).toBeUndefined();
  });

  it("renders on a log x scale without falling over", () => {
    const { container, histogram } = build([[1, 10, 100]], {
      xScaleType: HISTOGRAM_SCALE.LOG,
      showStatistics: false,
    });
    histogram.update();
    expect(container.querySelectorAll("g.bar-0 rect").length).toBeGreaterThan(
      0,
    );
  });

  it("renders on a symlog y scale without falling over", () => {
    const { container, histogram } = build([[1, 2, 2, 3, 3, 3]], {
      yScaleType: HISTOGRAM_SCALE.SYM_LOG,
      showStatistics: false,
    });
    histogram.update();
    expect(container.querySelectorAll("g.bar-0 rect").length).toBeGreaterThan(
      0,
    );
  });
});

// The handlers above are wired onto each rect by update(). These drive them the
// way the browser does -- by dispatching a real event at the element -- which is
// what proves the wiring (right handler, right series index, right bar index)
// rather than just that the handler bodies work.
describe("Histogram bar events dispatched from the DOM", () => {
  function renderTwoSeries(options: Record<string, unknown> = {}) {
    const { container, histogram } = build(
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      { colors: ["#00ff00", "#00ee00"], showStatistics: false, ...options },
    );
    histogram.update();
    return { container, histogram };
  }

  it("routes a bar mouseover to onHistogramBarEnter with that series' data", () => {
    const onHistogramBarEnter = jest.fn();
    const { container, histogram } = renderTwoSeries({ onHistogramBarEnter });

    const secondSeriesBar = container.querySelector("g.bar-1 rect");
    secondSeriesBar?.dispatchEvent(new MouseEvent("mouseover"));

    expect(onHistogramBarEnter).toHaveBeenCalledTimes(1);
    // The second argument identifies which series was hovered.
    expect(onHistogramBarEnter.mock.calls[0][1]).toBe(histogram.data[1]);
  });

  it("routes a bar click to onHistogramBarClick and stops propagation", () => {
    const onHistogramBarClick = jest.fn();
    const stopPropagation = jest.fn();
    mockState.event = { clientX: 0, clientY: 0, stopPropagation };
    const { container, histogram } = renderTwoSeries({ onHistogramBarClick });

    const bars = container.querySelectorAll("g.bar-0 rect");
    bars[1]?.dispatchEvent(new MouseEvent("click"));

    expect(onHistogramBarClick).toHaveBeenCalledWith(histogram.data[0], 1);
    // The bar click must not bubble out to onHistogramEmptyClick on the svg.
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("recolors a bar on mouseover and restores it on mouseleave", () => {
    // onHistogramBarHover is supplied because onBarMouseOut calls it
    // unconditionally -- see the note above onBarMouseMove below.
    const { container } = renderTwoSeries({
      hoverColors: ["#ff0000", "#ee0000"],
      onHistogramBarHover: jest.fn(),
    });

    const bar = container.querySelector("g.bar-0 rect");
    bar?.dispatchEvent(new MouseEvent("mouseover"));
    expect(bar?.getAttribute("fill")).toBe("#ff0000");

    bar?.dispatchEvent(new MouseEvent("mouseleave"));
    expect(bar?.getAttribute("fill")).toBe("#00ff00");
  });

  // NOTE: onBarMouseMove and onBarMouseOut call this.options.onHistogramBarHover
  // with no guard, unlike every sibling handler (onBarMouseOver, onBarClick,
  // onMouseMove all check the option is present first). A Histogram built
  // without onHistogramBarHover therefore throws a TypeError from these two.
  // It is latent rather than live today: the only such caller (TaxonHistogram)
  // uses the default hoverBuffer of 5, and the resulting hover rect overlays the
  // bars and swallows their mouse events. These tests supply the callback rather
  // than assert the throw, so that guarding the calls does not fail the suite.
  it("recolors a bar on mousedown and back to the hover color on mouseup", () => {
    const { container } = renderTwoSeries({
      hoverColors: ["#ff0000", "#ee0000"],
      clickColors: ["#0000ff", "#0000ee"],
    });

    const bar = container.querySelector("g.bar-0 rect");
    bar?.dispatchEvent(new MouseEvent("mousedown"));
    expect(bar?.getAttribute("fill")).toBe("#0000ff");

    bar?.dispatchEvent(new MouseEvent("mouseup"));
    expect(bar?.getAttribute("fill")).toBe("#ff0000");
  });

  it("reports viewport coordinates on a bar mousemove", () => {
    const onHistogramBarHover = jest.fn();
    const { container } = renderTwoSeries({ onHistogramBarHover });

    mockState.event = { clientX: 55, clientY: 66 };
    container
      .querySelector("g.bar-0 rect")
      ?.dispatchEvent(new MouseEvent("mousemove"));

    expect(onHistogramBarHover).toHaveBeenCalledWith(55, 66);
  });

  it("routes a click on empty svg space to onHistogramEmptyClick", () => {
    const onHistogramEmptyClick = jest.fn();
    const { container } = renderTwoSeries({ onHistogramEmptyClick });

    container.querySelector("svg")?.dispatchEvent(new MouseEvent("click"));
    expect(onHistogramEmptyClick).toHaveBeenCalled();
  });
});

describe("Histogram bar event handlers", () => {
  it("passes the hovered bin and its series to onHistogramBarEnter", () => {
    const onHistogramBarEnter = jest.fn();
    const { histogram } = build([[1, 2, 3]], { onHistogramBarEnter });
    histogram.update();

    const bin = { x0: 1, x1: 2 };
    histogram.onBarMouseOver(bin, 0, 0);
    expect(onHistogramBarEnter).toHaveBeenCalledWith(bin, histogram.data[0]);
  });

  it("recolors the hovered bar when hoverColors are configured", () => {
    const { container, histogram } = build([[1, 2, 3]], {
      hoverColors: ["#ff0000"],
    });
    histogram.update();

    histogram.onBarMouseOver({}, 0, 0);
    expect(container.querySelector(".rect-0")?.getAttribute("fill")).toBe(
      "#ff0000",
    );
  });

  it("restores the base color on mouse out and clears the hover tooltip", () => {
    const onHistogramBarHover = jest.fn();
    const { container, histogram } = build([[1, 2, 3]], {
      colors: ["#00ff00"],
      hoverColors: ["#ff0000"],
      onHistogramBarHover,
    });
    histogram.update();

    histogram.onBarMouseOver({}, 0, 0);
    histogram.onBarMouseOut(0, 0);
    expect(container.querySelector(".rect-0")?.getAttribute("fill")).toBe(
      "#00ff00",
    );
    expect(onHistogramBarHover).toHaveBeenCalledWith();
  });

  it("applies clickColors on mouse down and hoverColors again on mouse up", () => {
    const { container, histogram } = build([[1, 2, 3]], {
      clickColors: ["#0000ff"],
      hoverColors: ["#ff0000"],
    });
    histogram.update();

    histogram.onBarMouseDown(0, 0);
    expect(container.querySelector(".rect-0")?.getAttribute("fill")).toBe(
      "#0000ff",
    );

    histogram.onBarMouseUp(0, 0);
    expect(container.querySelector(".rect-0")?.getAttribute("fill")).toBe(
      "#ff0000",
    );
  });

  it("leaves the bar alone on mouse down when no clickColors are set", () => {
    const { container, histogram } = build([[1, 2, 3]], {
      colors: ["#00ff00"],
    });
    histogram.update();

    histogram.onBarMouseDown(0, 0);
    expect(container.querySelector(".rect-0")?.getAttribute("fill")).toBeNull();
  });

  it("forwards the series and bar index to onHistogramBarClick", () => {
    const onHistogramBarClick = jest.fn();
    const { histogram } = build([[1, 2, 3]], { onHistogramBarClick });
    histogram.update();

    histogram.onBarClick(0, 2);
    expect(onHistogramBarClick).toHaveBeenCalledWith(histogram.data[0], 2);
  });

  it("does not throw when onHistogramBarClick is not configured", () => {
    const { histogram } = build([[1, 2, 3]]);
    histogram.update();
    expect(() => histogram.onBarClick(0, 0)).not.toThrow();
  });

  it("reports viewport coordinates on bar mouse move", () => {
    const onHistogramBarHover = jest.fn();
    const { histogram } = build([[1, 2, 3]], { onHistogramBarHover });
    histogram.update();

    mockState.event = { clientX: 12, clientY: 34 };
    histogram.onBarMouseMove();
    expect(onHistogramBarHover).toHaveBeenCalledWith(12, 34);
  });
});

describe("Histogram.highlightBar", () => {
  it("does nothing without dataIndices", () => {
    const { histogram } = build([[1, 2, 3]], { hoverColors: ["#ff0000"] });
    histogram.update();
    expect(() => histogram.highlightBar(null, true)).not.toThrow();
  });

  it("does nothing when hoverColors are not configured", () => {
    const { container, histogram } = build([[1, 2, 3]], {
      colors: ["#00ff00"],
    });
    histogram.update();
    histogram.highlightBar([0, 0], true);
    expect(
      container.querySelector(".bar-0 .rect-0")?.getAttribute("fill"),
    ).toBe(null);
  });

  it("paints the hover color when highlighting", () => {
    const { container, histogram } = build([[1, 2, 3]], {
      colors: ["#00ff00"],
      hoverColors: ["#ff0000"],
    });
    histogram.update();

    histogram.highlightBar([0, 0], true);
    expect(
      container.querySelector(".bar-0 .rect-0")?.getAttribute("fill"),
    ).toBe("#ff0000");
  });

  it("restores the base color when un-highlighting", () => {
    const { container, histogram } = build([[1, 2, 3]], {
      colors: ["#00ff00"],
      hoverColors: ["#ff0000"],
    });
    histogram.update();

    histogram.highlightBar([0, 0], true);
    histogram.highlightBar([0, 0], false);
    expect(
      container.querySelector(".bar-0 .rect-0")?.getAttribute("fill"),
    ).toBe("#00ff00");
  });
});

describe("Histogram.getHighlightedBar", () => {
  it("returns the indices of the bar under the cursor", () => {
    const { histogram } = build([[1, 2, 3, 4, 5]]);
    histogram.update();

    const [firstCenter] = histogram.sortedBarCenters;
    mockState.mouseX = firstCenter;

    const { dataIndices, closestX } = histogram.getHighlightedBar();
    expect(closestX).toBe(firstCenter);
    expect(dataIndices).toEqual(histogram.barCentersToIndices[firstCenter]);
  });

  it("returns null indices when the cursor is beyond the hover buffer", () => {
    const { histogram } = build([[1, 2, 3, 4, 5]], { hoverBuffer: 0 });
    histogram.update();

    mockState.mouseX = 100000;
    const { dataIndices } = histogram.getHighlightedBar();
    expect(dataIndices).toBeNull();
  });

  it("picks the nearer of two bracketing bar centers", () => {
    const { histogram } = build([[1, 2, 3, 4, 5]]);
    histogram.update();

    const [a, b] = histogram.sortedBarCenters;
    // Sit just to the right of the midpoint: b should win.
    mockState.mouseX = (a + b) / 2 + 1;
    const { closestX } = histogram.getHighlightedBar();
    expect(closestX).toBe(b);
  });
});

describe("Histogram.onMouseMove", () => {
  it("bails out when there are no bars to hover", () => {
    const { histogram } = build([[]]);
    histogram.update();
    histogram.sortedBarCenters = [];
    expect(() => histogram.onMouseMove()).not.toThrow();
  });

  it("fires onHistogramBarEnter and records the hovered bar", () => {
    const onHistogramBarEnter = jest.fn();
    const { histogram } = build([[1, 2, 3, 4, 5]], {
      onHistogramBarEnter,
      hoverColors: ["#ff0000"],
    });
    histogram.update();

    const [firstCenter] = histogram.sortedBarCenters;
    mockState.mouseX = firstCenter;
    histogram.onMouseMove();

    expect(onHistogramBarEnter).toHaveBeenCalledWith(
      histogram.barCentersToIndices[firstCenter],
      histogram.data[0],
    );
    expect(histogram.lastHoveredBarX).toBe(firstCenter);
  });

  it("does not re-fire onHistogramBarEnter while on the same bar", () => {
    const onHistogramBarEnter = jest.fn();
    const { histogram } = build([[1, 2, 3, 4, 5]], { onHistogramBarEnter });
    histogram.update();

    mockState.mouseX = histogram.sortedBarCenters[0];
    histogram.onMouseMove();
    histogram.onMouseMove();
    expect(onHistogramBarEnter).toHaveBeenCalledTimes(1);
  });

  it("fires onHistogramBarExit once the cursor leaves every bar", () => {
    const onHistogramBarExit = jest.fn();
    const { histogram } = build([[1, 2, 3, 4, 5]], {
      onHistogramBarExit,
      hoverBuffer: 0,
    });
    histogram.update();

    mockState.mouseX = histogram.sortedBarCenters[0];
    histogram.onMouseMove();
    expect(histogram.lastHoveredBarX).not.toBeNull();

    mockState.mouseX = 100000;
    histogram.onMouseMove();

    expect(onHistogramBarExit).toHaveBeenCalledTimes(1);
    expect(histogram.lastHoveredBarX).toBeNull();
  });

  it("reports viewport coordinates while over a bar", () => {
    const onHistogramBarHover = jest.fn();
    const { histogram } = build([[1, 2, 3, 4, 5]], { onHistogramBarHover });
    histogram.update();

    mockState.mouseX = histogram.sortedBarCenters[0];
    mockState.event = { clientX: 7, clientY: 8 };
    histogram.onMouseMove();

    expect(onHistogramBarHover).toHaveBeenCalledWith(7, 8);
  });

  it("moves the highlight from the old bar to the new one", () => {
    const { container, histogram } = build([[1, 2, 3, 4, 5]], {
      colors: ["#00ff00"],
      hoverColors: ["#ff0000"],
    });
    histogram.update();

    const [first, second] = histogram.sortedBarCenters;
    const [, firstIndex] = histogram.barCentersToIndices[first];
    const [, secondIndex] = histogram.barCentersToIndices[second];

    mockState.mouseX = first;
    histogram.onMouseMove();
    mockState.mouseX = second;
    histogram.onMouseMove();

    expect(
      container
        .querySelector(`.bar-0 .rect-${secondIndex}`)
        ?.getAttribute("fill"),
    ).toBe("#ff0000");
    expect(
      container
        .querySelector(`.bar-0 .rect-${firstIndex}`)
        ?.getAttribute("fill"),
    ).toBe("#00ff00");
  });
});

describe("Histogram.onMouseLeave", () => {
  it("clears the hovered bar and fires onHistogramBarExit", () => {
    const onHistogramBarExit = jest.fn();
    const { container, histogram } = build([[1, 2, 3, 4, 5]], {
      onHistogramBarExit,
      colors: ["#00ff00"],
      hoverColors: ["#ff0000"],
    });
    histogram.update();

    const [first] = histogram.sortedBarCenters;
    const [, firstIndex] = histogram.barCentersToIndices[first];
    mockState.mouseX = first;
    histogram.onMouseMove();

    histogram.onMouseLeave();

    expect(onHistogramBarExit).toHaveBeenCalled();
    expect(histogram.lastHoveredBarX).toBeNull();
    expect(
      container
        .querySelector(`.bar-0 .rect-${firstIndex}`)
        ?.getAttribute("fill"),
    ).toBe("#00ff00");
  });

  it("is a no-op when nothing was hovered", () => {
    const { histogram } = build([[1, 2, 3]]);
    histogram.update();
    expect(() => histogram.onMouseLeave()).not.toThrow();
    expect(histogram.lastHoveredBarX).toBeNull();
  });
});

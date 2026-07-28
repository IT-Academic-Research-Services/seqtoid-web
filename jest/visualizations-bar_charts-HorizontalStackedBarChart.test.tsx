// Coverage: app/assets/src/components/visualizations/bar_charts/
//   HorizontalStackedBarChart.tsx
//
// A d3-driven stacked bar chart class component. On first render redrawNeeded
// is true, so it renders the "baseline" measurement branch; componentDidMount
// then measures the (zero-sized in jsdom) refs and componentDidUpdate flips to
// the drawn branch that emits the XAxis, YAxis and the visible/invisible bar
// groups. The XAxis / YAxis children are stubbed so this file's assertions land
// on HorizontalStackedBarChart's own option-merging, dimension and render
// logic rather than the d3 axis internals. We also instantiate the class
// directly to exercise the pre-mount option/sort helpers in isolation.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import HorizontalStackedBarChart from "~/components/visualizations/bar_charts/HorizontalStackedBarChart";

/* eslint-disable @typescript-eslint/no-explicit-any */

const _React: typeof React = React;

const mockAxis: { x: any; y: any } = { x: null, y: null };

jest.mock(
  "~/components/visualizations/bar_charts/XAxis",
  () => ({
    __esModule: true,
    default: (props: any) => {
      mockAxis.x = props;
      return require("react").createElement("div", { "data-testid": "x-axis" });
    },
  }),
  { virtual: false },
);

jest.mock(
  "~/components/visualizations/bar_charts/YAxis",
  () => ({
    __esModule: true,
    default: (props: any) => {
      mockAxis.y = props;
      return require("react").createElement("div", { "data-testid": "y-axis" });
    },
  }),
  { virtual: false },
);

const DATA = () => [
  { item: "Alpha", monday: 10, tuesday: 7, total: 17 },
  { item: "Beta", monday: 3, tuesday: 5, total: 8 },
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
      data={DATA()}
      keys={KEYS}
      yAxisKey="item"
      events={events}
      {...overrides}
    />,
  );
  return { events, ...utils };
}

beforeEach(() => {
  mockAxis.x = null;
  mockAxis.y = null;
});

describe("HorizontalStackedBarChart rendering", () => {
  it("reaches the drawn branch after mount and renders the axes and bars", () => {
    renderChart();
    // The measurement pass has flipped redrawNeeded off and drawn the canvas.
    expect(screen.getByTestId("read-lost-bar")).toBeTruthy();
    expect(screen.getByTestId("x-axis")).toBeTruthy();
    expect(screen.getByTestId("y-axis")).toBeTruthy();
  });

  it("labels the x-axis 'Number of ...' when not normalized", () => {
    renderChart({ options: { x: { axisTitle: "Sales" } } });
    expect(mockAxis.x.title).toBe("Number of Sales");
  });

  it("labels the x-axis 'Percentage of ...' when normalized", () => {
    renderChart({ normalize: true, options: { x: { axisTitle: "Sales" } } });
    expect(mockAxis.x.title).toBe("Percentage of Sales");
  });

  it("passes the y-axis labels through to the YAxis child", () => {
    renderChart();
    // With zero-width labels in jsdom nothing is truncated, so the labels are
    // the raw y-domain values.
    expect(mockAxis.y.labels).toEqual(["Alpha", "Beta"]);
  });
});

describe("HorizontalStackedBarChart y-axis callbacks", () => {
  it("forwards a label click to the onYAxisLabelClick event with the row datum", () => {
    const { events } = renderChart();
    mockAxis.y.onYAxisLabelClick("Alpha", 0);
    expect(events.onYAxisLabelClick).toHaveBeenCalledWith("Alpha", {
      item: "Alpha",
      monday: 10,
      tuesday: 7,
      total: 17,
    });
  });

  it("forwards a label hover to the onYAxisLabelEnter event with the row datum", () => {
    const { events } = renderChart();
    mockAxis.y.onYAxisLabelEnter("Beta", 1);
    expect(events.onYAxisLabelEnter).toHaveBeenCalledWith("Beta", {
      item: "Beta",
      monday: 3,
      tuesday: 5,
      total: 8,
    });
  });

  it("fires onChartHover on mouse move and exit handlers on mouse leave", () => {
    const { events } = renderChart();
    const svg = screen.getByTestId("read-lost-bar");
    // svg -> barCanvas div -> canvas div -> outer chart div (owns the handlers).
    const chartDiv = svg.parentElement!.parentElement!.parentElement as Element;
    fireEvent.mouseMove(chartDiv, { clientX: 12, clientY: 34 });
    expect(events.onChartHover).toHaveBeenCalledWith(12, 34);
    fireEvent.mouseLeave(chartDiv, { clientX: 0, clientY: 0 });
    expect(events.onChartElementExit).toHaveBeenCalled();
  });
});

describe("HorizontalStackedBarChart normalize mode", () => {
  it("still renders the drawn canvas when normalized (invisible bars suppressed)", () => {
    renderChart({ normalize: true });
    expect(screen.getByTestId("read-lost-bar")).toBeTruthy();
    // The XAxis tickFormat returns a percentage string in normalize mode.
    expect(mockAxis.x.tickFormat(50)).toContain("%");
  });

  it("uses a non-percentage tick format when not normalized", () => {
    renderChart();
    expect(mockAxis.x.tickFormat(50)).not.toContain("%");
  });
});

describe("HorizontalStackedBarChart option merging (pre-mount)", () => {
  const construct = (props: Record<string, any> = {}) =>
    new (HorizontalStackedBarChart as any)({
      data: DATA(),
      keys: KEYS,
      yAxisKey: "item",
      options: {},
      ...props,
    });

  it("derives dataKeys by excluding the yAxisKey", () => {
    const instance = construct();
    expect(instance.state.dataKeys).toEqual(["monday", "tuesday"]);
  });

  it("falls back to the default colors when none are supplied", () => {
    const instance = construct();
    expect(instance.state.options.colors[0]).toBe("#AABDFC");
  });

  it("overrides the default colors when supplied in options", () => {
    const instance = construct({ options: { colors: ["#111111"] } });
    expect(instance.state.options.colors).toEqual(["#111111"]);
  });

  it("merges reference option groups (x/y/bars) over the defaults", () => {
    const instance = construct({ options: { bars: { height: 99 } } });
    // Overridden value wins, unspecified defaults are retained.
    expect(instance.state.options.bars.height).toBe(99);
    expect(instance.state.options.bars.padding).toBe(6);
  });

  it("sorts both raw and normalized data when a sort comparator is given", () => {
    const sort = (a: any, b: any) => a.total - b.total;
    const instance = construct({ options: { sort } });
    // Beta (total 8) sorts before Alpha (total 17).
    expect(instance.data.map((d: any) => d.item)).toEqual(["Beta", "Alpha"]);
  });

  it("selects normalized data for state when normalize is true", () => {
    const instance = construct({ normalize: true });
    // normalizeData rescales each row's total to 100.
    expect(instance.state.data.every((d: any) => d.total === 100)).toBe(true);
  });
});

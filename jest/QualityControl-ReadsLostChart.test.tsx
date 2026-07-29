// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/components/QualityControl/components/ReadsLostChart/ReadsLostChart.tsx
//
// The component turns per-sample pipeline step counts into a stacked bar chart.
// relay-test-utils is not installed, so useLazyLoadQuery is stubbed to return a
// fixture; the D3 stacked-bar chart is stubbed so the props it receives (the
// derived rows, category keys and event handlers) can be inspected and the
// handlers invoked directly -- that is the only route into the tooltip builders
// and the sample-label click behaviour.
import { fireEvent, render, screen } from "@testing-library/react";

const mockUseLazyLoadQuery = jest.fn();

jest.mock("react-relay", () => ({
  graphql: () => ({}),
  useLazyLoadQuery: (...args: unknown[]) => mockUseLazyLoadQuery(...args),
}));

jest.mock(
  "~/components/visualizations/bar_charts/HorizontalStackedBarChart",
  () => ({
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      (global as any).__stackedBarChartProps = props;
      return <div data-testid="stacked-bar-chart" />;
    },
  }),
);

import { ReadsLostChart } from "~/components/views/DiscoveryView/components/SamplesView/components/QualityControl/components/ReadsLostChart/ReadsLostChart";

const chartProps = () => (global as any).__stackedBarChartProps;

// Sample 1 ran on pipeline 4.x, so its dedup step is dropped. Sample 2 ran on
// 3.x, so its dedup step is kept. Sample 3 has no initialReads and is skipped
// entirely.
const sampleReadsStats = [
  {
    sampleId: "1",
    name: "Sample One",
    initialReads: 1000,
    pipelineVersion: "4.0",
    wdlVersion: "1.0",
    steps: [
      { name: "Idseq Dedup", readsAfter: 900 },
      { name: "Star", readsAfter: 800 },
      { name: "Trimmomatic", readsAfter: 600 },
    ],
  },
  {
    sampleId: "2",
    name: "Sample Two",
    initialReads: 500,
    pipelineVersion: "3.9",
    wdlVersion: "1.0",
    steps: [
      { name: "Cdhitdup", readsAfter: 450 },
      // A null readsAfter means "no reads lost at this step".
      { name: "Lzw", readsAfter: null },
    ],
  },
  {
    sampleId: "3",
    name: "Sample Three",
    initialReads: null,
    pipelineVersion: "4.0",
    wdlVersion: "1.0",
    steps: [{ name: "Star", readsAfter: 10 }],
  },
];

const validSamples = [
  { id: 1, name: "Sample One" },
  { id: 2, name: "Sample Two" },
] as any;

const renderChart = (overrides: Record<string, any> = {}) => {
  const props = {
    validSamples,
    handleChartElementHover: jest.fn(),
    handleChartElementExit: jest.fn(),
    setChartTooltipData: jest.fn(),
    setTooltipClass: jest.fn(),
    setSidebarVisible: jest.fn(),
    setSidebarParams: jest.fn(),
    sidebarParams: { sampleId: 1 },
    sidebarVisible: false,
    ...overrides,
  };
  const utils = render(<ReadsLostChart {...(props as any)} />);
  return { ...utils, props };
};

beforeEach(() => {
  (global as any).__stackedBarChartProps = undefined;
  mockUseLazyLoadQuery.mockReset();
  mockUseLazyLoadQuery.mockReturnValue({
    sampleReadsStats: { sampleReadsStats },
  });
});

describe("ReadsLostChart", () => {
  it("queries only the ids of the samples it was given", () => {
    renderChart();
    expect(mockUseLazyLoadQuery.mock.calls[0][1]).toEqual({
      sampleIds: ["1", "2"],
    });
  });

  it("renders the section headings and the chart", () => {
    renderChart();
    expect(screen.getByTestId("sample-processed-check").textContent).toBe(
      "How were my samples processed through the pipeline?",
    );
    expect(screen.getByTestId("read-lost-title").textContent).toContain(
      "Reads Lost",
    );
    expect(screen.getByTestId("stacked-bar-chart")).toBeTruthy();
  });

  it("humanizes step names and appends the passed-filters category", () => {
    renderChart();
    expect(chartProps().keys).toEqual([
      "Filter duplicates",
      "Filter low complexity",
      "Filter host (STAR)",
      "Trim adapters",
      "Passed Filters",
    ]);
  });

  it("drops the dedup step for pipeline versions >= 4 but keeps it below 4", () => {
    renderChart();
    const [one, two] = chartProps().data;
    // Sample One's dedup step was filtered out, so its 100 lost reads are not
    // attributed anywhere -- they roll into the STAR step instead.
    expect(one["Filter duplicates"]).toBe(0);
    expect(one["Filter host (STAR)"]).toBe(200);
    expect(one["Trim adapters"]).toBe(200);
    // Sample Two kept its (Cdhitdup) dedup step.
    expect(two["Filter duplicates"]).toBe(50);
  });

  it("zero-fills categories a sample never ran and carries totals through", () => {
    renderChart();
    const [one, two] = chartProps().data;
    expect(one).toMatchObject({
      name: "Sample One",
      total: 1000,
      "Filter low complexity": 0,
      "Passed Filters": 600,
    });
    // A null readsAfter loses no reads, so the remainder is unchanged.
    expect(two).toMatchObject({
      name: "Sample Two",
      total: 500,
      "Filter low complexity": 0,
      "Filter host (STAR)": 0,
      "Trim adapters": 0,
      "Passed Filters": 450,
    });
  });

  it("omits samples that never reported an initial read count", () => {
    renderChart();
    expect(chartProps().data).toHaveLength(2);
    expect(
      chartProps().data.map((row: { name: string }) => row.name),
    ).not.toContain("Sample Three");
  });

  it("colours the passed-filters category differently from the lost categories", () => {
    const { container } = renderChart();
    // CategoricalLegend renders one <circle fill="..."> swatch per category, in
    // category order.
    const colors = Array.from(container.querySelectorAll("circle")).map(c =>
      c.getAttribute("fill"),
    );
    expect(colors).toEqual([
      "#AABDFC",
      "#DF87B0",
      "#88D0CA",
      "#2C8CB5",
      // Passed Filters always uses the dedicated remaining colour rather than
      // the next colour in the stack palette.
      "#693BAC",
    ]);
    expect(
      Array.from(
        container.querySelectorAll('[data-testid="category-label"]'),
      ).map(el => el.textContent),
    ).toEqual([
      "Filter duplicates",
      "Filter low complexity",
      "Filter host (STAR)",
      "Trim adapters",
      "Passed Filters",
    ]);
  });

  it("renders the no-data banner instead of the chart when no sample has steps", () => {
    mockUseLazyLoadQuery.mockReturnValue({
      sampleReadsStats: { sampleReadsStats: [] },
    });
    renderChart();
    expect(screen.queryByTestId("stacked-bar-chart")).toBeNull();
    expect(screen.getByText("Reads Lost Visualization")).toBeTruthy();
    expect(
      screen.getByText("No reads lost data could be found for your samples."),
    ).toBeTruthy();
  });

  it("starts in count mode and switches to percentage mode via the toggle", () => {
    renderChart();
    expect(chartProps().normalize).toBe(false);
    const toggle = screen.getByTestId("bar-chart-toggle");
    const items = toggle.querySelectorAll(".item");
    expect(items.length).toBe(2);
    fireEvent.click(items[1]);
    expect(chartProps().normalize).toBe(true);
  });

  it("builds a single-stack tooltip with the raw count, and a percentage once normalized", () => {
    const { props } = renderChart();
    chartProps().events.onBarStackEnter("Trim adapters", 1234);
    let payload = props.setChartTooltipData.mock.calls.at(-1)[0];
    expect(payload[0].name).toBe("Info");
    expect(payload[0].data[0][1]).toBe("1,234");
    expect(payload[0].disabled).toBe(false);

    // Switch to percentage display and re-enter the same stack.
    fireEvent.click(
      screen.getByTestId("bar-chart-toggle").querySelectorAll(".item")[1],
    );
    chartProps().events.onBarStackEnter("Trim adapters", 12);
    payload = props.setChartTooltipData.mock.calls.at(-1)[0];
    expect(payload[0].data[0][1]).toBe("12%");
  });

  it("summarizes every lost category plus the remainder on empty-bar hover", () => {
    const { props } = renderChart();
    const row = chartProps().data[0];
    chartProps().events.onBarEmptySpaceEnter(row);

    const payload = props.setChartTooltipData.mock.calls.at(-1)[0];
    expect(payload.map((section: { name: string }) => section.name)).toEqual([
      "Total reads",
      "Reads lost",
      "Passed Filters",
    ]);
    expect(payload[0].data).toEqual([["Total reads", "1,000"]]);
    // One summary line per lost category -- "Passed Filters" is excluded.
    expect(payload[1].data).toHaveLength(4);
    expect(payload[1].data.map((entry: unknown[]) => entry[1])).toEqual([
      "0",
      "0",
      "200",
      "200",
    ]);
    expect(payload[2].data[0][1]).toBe("600");
    // The summary tooltip gets its own class.
    expect(props.setTooltipClass).toHaveBeenCalled();
  });

  it("shows the sample name when its axis label is hovered", () => {
    const { props } = renderChart();
    chartProps().events.onYAxisLabelEnter("Sample Two");
    expect(props.setChartTooltipData).toHaveBeenLastCalledWith([
      { name: "Info", data: [["Sample Name", "Sample Two"]], disabled: false },
    ]);
  });

  it("opens the sidebar for the clicked sample", () => {
    const { props } = renderChart();
    chartProps().events.onYAxisLabelClick("Sample Two");
    expect(props.setSidebarVisible).toHaveBeenCalledWith(true);
    expect(props.setSidebarParams).toHaveBeenCalledWith({ sampleId: 2 });
  });

  it("closes the sidebar when the already-shown sample is clicked again", () => {
    const { props } = renderChart({
      sidebarVisible: true,
      sidebarParams: { sampleId: 2 },
    });
    chartProps().events.onYAxisLabelClick("Sample Two");
    expect(props.setSidebarVisible).toHaveBeenCalledWith(false);
    expect(props.setSidebarParams).not.toHaveBeenCalled();
  });

  it("does nothing for a label that matches no known sample", () => {
    const { props } = renderChart();
    chartProps().events.onYAxisLabelClick("Sample Nine");
    expect(props.setSidebarVisible).not.toHaveBeenCalled();
    expect(props.setSidebarParams).not.toHaveBeenCalled();
  });

  it("forwards chart hover and exit to the parent handlers", () => {
    const { props } = renderChart();
    chartProps().events.onChartHover(10, 20);
    expect(props.handleChartElementHover).toHaveBeenCalledWith(10, 20);
    chartProps().events.onChartElementExit();
    expect(props.handleChartElementExit).toHaveBeenCalled();
  });

  it("hides the chart axis paths and ticks and labels the x axis", () => {
    renderChart();
    expect(chartProps().options.x).toMatchObject({
      pathVisible: false,
      ticksVisible: false,
      axisTitle: "reads",
    });
    expect(chartProps().options.y).toMatchObject({
      pathVisible: false,
      ticksVisible: false,
    });
    expect(chartProps().yAxisKey).toBe("name");
    expect(chartProps().options.colors).toHaveLength(5);
  });
});

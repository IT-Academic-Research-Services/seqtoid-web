// Coverage: app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/components/ERCCScatterPlot/ERCCScatterPlot.tsx
//
// ERCCScatterPlot filters the ercc_comparison rows (dropping null rows, rows
// with actual == 0/null/undefined, and rows with expected null/undefined),
// log10-transforms the survivors and either renders "No data" or hands the
// cleaned data to ScatterPlot. The d3-backed ScatterPlot child is stubbed so
// the assertions land on this component's filtering/transform branches.
import { render, screen } from "@testing-library/react";

const mockScatterPlotProps: Record<string, unknown>[] = [];

jest.mock(
  "~/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/components/ERCCScatterPlot/components/ScatterPlot",
  () => {
    const ReactLib = require("react");
    return {
      ScatterPlot: (props: Record<string, unknown>) => {
        mockScatterPlotProps.push(props);
        return ReactLib.createElement("div", {
          "data-testid": "scatter-plot",
          "data-points": JSON.stringify(props.data),
        });
      },
    };
  },
);

import { ERCCScatterPlot } from "~/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/components/ERCCScatterPlot/ERCCScatterPlot";

describe("ERCCScatterPlot", () => {
  beforeEach(() => {
    mockScatterPlotProps.length = 0;
  });

  it("renders 'No data' when erccComparison is undefined", () => {
    render(<ERCCScatterPlot width={100} height={100} />);
    expect(screen.getByText("No data")).toBeTruthy();
    expect(screen.queryByTestId("scatter-plot")).toBeNull();
  });

  it("renders 'No data' when every row is filtered out", () => {
    render(
      <ERCCScatterPlot
        width={100}
        height={100}
        erccComparison={[
          null,
          { actual: 0, expected: 5 },
          { actual: null, expected: 5 },
          { actual: undefined, expected: 5 },
          { actual: 10, expected: null },
          { actual: 10, expected: undefined },
        ]}
      />,
    );
    expect(screen.getByText("No data")).toBeTruthy();
    expect(screen.queryByTestId("scatter-plot")).toBeNull();
  });

  it("log10-transforms surviving rows and renders the ScatterPlot", () => {
    render(
      <ERCCScatterPlot
        width={640}
        height={480}
        erccComparison={[
          null,
          { actual: 100, expected: 1000 },
          { actual: 0, expected: 9 }, // dropped: actual === 0
          { actual: 10, expected: 10 },
        ]}
      />,
    );
    expect(screen.queryByText("No data")).toBeNull();
    const plot = screen.getByTestId("scatter-plot");
    const points = JSON.parse(plot.getAttribute("data-points") as string);
    expect(points).toEqual([
      { actual: 2, expected: 3 },
      { actual: 1, expected: 1 },
    ]);

    // ScatterPlot receives the axis/dimension props unchanged.
    const props = mockScatterPlotProps[0];
    expect(props.width).toBe(640);
    expect(props.height).toBe(480);
    expect(props.xKey).toBe("expected");
    expect(props.yKey).toBe("actual");
    expect(props.xLabel).toBe("log10 spike-in concentrations");
    expect(props.yLabel).toBe("log10 read-pairs per gene");
  });
});

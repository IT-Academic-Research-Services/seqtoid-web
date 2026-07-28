// Coverage:
// app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/components/ERCCScatterPlot/components/ScatterPlot.tsx
//
// ScatterPlot is a memoized D3 chart. On every render it wipes any prior <svg>,
// rebuilds axes/points, and -- only when there are >=2 data points -- fits a
// least-squares trend line (leastSquares + sum helpers). The two tests below
// drive both sides of that `data.length < 2` guard against a real jsdom DOM so
// the axis/points/trendline drawing and the regression math all execute.
import { render } from "@testing-library/react";
import React from "react";
import { ScatterPlot } from "~/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/components/ERCCScatterPlot/components/ScatterPlot";

// Keep the classic-runtime React import in scope for organize-imports.
const _React: typeof React = React;

const baseProps = {
  xKey: "x",
  yKey: "y",
  width: 400,
  height: 300,
  xLabel: "expected",
  yLabel: "observed",
};

describe("ScatterPlot", () => {
  it("draws a point per datum and a trend line when there are >=2 points", () => {
    const data = [
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 5 },
    ];
    const { container } = render(<ScatterPlot data={data} {...baseProps} />);

    // The wrapper div is always present, and D3 appends exactly one svg into it.
    const wrapper = container.querySelector(".scatterplot") as HTMLElement;
    expect(wrapper).not.toBeNull();
    const svgs = wrapper.querySelectorAll("svg");
    expect(svgs.length).toBe(1);

    // One circle per datum, carrying the raw values via data-x / data-y.
    const points = wrapper.querySelectorAll("circle.point");
    expect(points.length).toBe(3);
    expect(points[0].getAttribute("data-x")).toBe("1");
    expect(points[0].getAttribute("data-y")).toBe("2");

    // The >=2 branch of renderFitLine draws a trendline; axis labels render too.
    expect(wrapper.querySelector("line.trendline")).not.toBeNull();
    expect(wrapper.textContent).toContain("expected");
    expect(wrapper.textContent).toContain("observed");
  });

  it("skips the trend line when there is a single point", () => {
    const data = [{ x: 5, y: 9 }];
    const { container } = render(<ScatterPlot data={data} {...baseProps} />);

    const wrapper = container.querySelector(".scatterplot") as HTMLElement;
    expect(wrapper.querySelectorAll("circle.point").length).toBe(1);
    // data.length < 2 -> renderFitLine returns early, no trendline element.
    expect(wrapper.querySelector("line.trendline")).toBeNull();
  });

  it("replaces the previous svg instead of stacking them on re-render", () => {
    const { container, rerender } = render(
      <ScatterPlot
        data={[
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ]}
        {...baseProps}
      />,
    );
    rerender(
      <ScatterPlot
        data={[
          { x: 1, y: 1 },
          { x: 2, y: 2 },
          { x: 3, y: 3 },
        ]}
        {...baseProps}
      />,
    );
    const wrapper = container.querySelector(".scatterplot") as HTMLElement;
    // The effect removes the old svg before appending, so still exactly one.
    expect(wrapper.querySelectorAll("svg").length).toBe(1);
    expect(wrapper.querySelectorAll("circle.point").length).toBe(3);
  });
});

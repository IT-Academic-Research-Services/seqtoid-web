// Coverage: app/assets/src/components/views/SamplesHeatmapView/components/
//   SamplesHeatmapLegend/SamplesHeatmapLegend.tsx
//
// The legend renders nothing while loading, when data is absent, or when the
// selected metric has no rows; otherwise it flattens the metric matrix, drops
// the "empty"/undefined placeholder cells and hands min/max plus the scale
// picked by dataScaleIdx to SequentialLegendVis. All four short-circuit
// conditions and the happy path are exercised. SequentialLegendVis is stubbed
// because the real one builds a D3 gradient against a DOM ref.
import { render, screen } from "@testing-library/react";

let lastLegendProps: $TSFixMe = null;
jest.mock("~/components/visualizations/legends/SequentialLegendVis", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) => {
      lastLegendProps = props;
      return ReactLib.createElement("div", {
        "data-testid": "sequential-legend",
        "data-min": String(props.min),
        "data-max": String(props.max),
        "data-scale": String(props.scale),
      });
    },
  };
});

import { SamplesHeatmapLegend } from "~/components/views/SamplesHeatmapView/components/SamplesHeatmapLegend/SamplesHeatmapLegend";

const OPTIONS = {
  scales: [
    ["Log", "symlog"],
    ["Lin", "linear"],
  ],
};

function renderLegend(overrides: $TSFixMe = {}) {
  const props = {
    data: {
      NT_rpm: [
        [1, 5, 3],
        [10, 2],
      ],
    },
    loading: false,
    selectedOptions: { metric: "NT_rpm", dataScaleIdx: 0 },
    options: OPTIONS,
    ...overrides,
  };
  return render(<SamplesHeatmapLegend {...(props as $TSFixMe)} />);
}

describe("SamplesHeatmapLegend", () => {
  beforeEach(() => {
    lastLegendProps = null;
  });

  it("renders nothing while loading, even with usable data", () => {
    const { container } = renderLegend({ loading: true });
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("sequential-legend")).toBeNull();
  });

  it("renders nothing when data is undefined", () => {
    const { container } = renderLegend({ data: undefined });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the selected metric is missing from data", () => {
    const { container } = renderLegend({
      selectedOptions: { metric: "NR_zscore", dataScaleIdx: 0 },
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the selected metric has no rows", () => {
    const { container } = renderLegend({ data: { NT_rpm: [] } });
    expect(container.innerHTML).toBe("");
  });

  it("renders the legend with the flattened min and max", () => {
    renderLegend();
    const legend = screen.getByTestId("sequential-legend");
    expect(legend.getAttribute("data-min")).toBe("1");
    expect(legend.getAttribute("data-max")).toBe("10");
  });

  it("ignores 'empty' and undefined placeholder cells when computing bounds", () => {
    renderLegend({
      data: {
        NT_rpm: [
          ["empty", 4, undefined],
          [undefined, 9, "empty"],
        ],
      },
    });
    const legend = screen.getByTestId("sequential-legend");
    expect(legend.getAttribute("data-min")).toBe("4");
    expect(legend.getAttribute("data-max")).toBe("9");
  });

  it("selects the scale function named by dataScaleIdx", () => {
    renderLegend({ selectedOptions: { metric: "NT_rpm", dataScaleIdx: 1 } });
    expect(lastLegendProps.scale).toBe("linear");

    renderLegend({ selectedOptions: { metric: "NT_rpm", dataScaleIdx: 0 } });
    expect(lastLegendProps.scale).toBe("symlog");
  });

  it("renders when the metric matrix is non-empty but entirely placeholders", () => {
    renderLegend({ data: { NT_rpm: [["empty", "empty"]] } });
    // Row count is non-zero so the guard passes; Math.min/max of nothing.
    const legend = screen.getByTestId("sequential-legend");
    expect(legend.getAttribute("data-min")).toBe("Infinity");
    expect(legend.getAttribute("data-max")).toBe("-Infinity");
  });
});

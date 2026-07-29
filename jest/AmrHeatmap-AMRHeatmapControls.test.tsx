// Coverage for app/assets/src/components/views/AmrHeatmap/AMRHeatmapControls.tsx
//
// A thin control bar: one Dropdown per control descriptor plus a colour legend
// that is suppressed while the heatmap data is still loading. Its own logic is
// (a) handleOptionChange, which de-dupes -- it only calls back when the picked
// option differs from the currently selected one -- and (b) the isDataReady
// branch, which both disables the dropdowns and hides the legend.
//
// The SDS/Semantic Dropdown and the D3-backed SequentialLegendVis are stubbed
// so the assertions target this component rather than their internals.
import { fireEvent, render, screen } from "@testing-library/react";
import AMRHeatmapControls from "~/components/views/AmrHeatmap/AMRHeatmapControls";

jest.mock("~ui/controls/dropdowns", () => ({
  Dropdown: ({ options, onChange, value, label, disabled }: $TSFixMe) => (
    <div data-testid={`dropdown-${label}`}>
      <span data-testid={`value-${label}`}>{value}</span>
      <span data-testid={`disabled-${label}`}>{String(disabled)}</span>
      <span data-testid={`options-${label}`}>
        {options.map((o: $TSFixMe) => o.value).join(",")}
      </span>
      {options.map((o: $TSFixMe) => (
        <button
          key={o.value}
          data-testid={`pick-${label}-${o.value}`}
          onClick={() => onChange(o.value)}
        />
      ))}
    </div>
  ),
}));

jest.mock("~/components/visualizations/legends/SequentialLegendVis", () => ({
  __esModule: true,
  default: ({ min, max, scale }: $TSFixMe) => (
    <div data-testid="legend" data-min={String(min)} data-max={String(max)}>
      {scale}
    </div>
  ),
}));

const controls = [
  {
    key: "metric",
    label: "Metric",
    options: [
      { text: "Coverage", value: "coverage" },
      { text: "Depth", value: "depth" },
    ],
  },
  {
    key: "viewLevel",
    label: "View Level",
    options: [
      { text: "Genes", value: "gene" },
      { text: "Alleles", value: "allele" },
    ],
  },
];

const selectedOptions = {
  metric: "coverage",
  viewLevel: "gene",
  scale: "symlog",
};

const renderControls = (props: $TSFixMe = {}) => {
  const onSelectedOptionsChange = jest.fn();
  const utils = render(
    <AMRHeatmapControls
      controls={controls}
      selectedOptions={selectedOptions}
      onSelectedOptionsChange={onSelectedOptionsChange}
      isDataReady={true}
      maxValueForLegend={100}
      {...props}
    />,
  );
  return { ...utils, onSelectedOptionsChange };
};

describe("AMRHeatmapControls", () => {
  it("renders one dropdown per control seeded with the selected value", () => {
    renderControls();
    expect(screen.getByTestId("value-Metric").textContent).toBe("coverage");
    expect(screen.getByTestId("value-View Level").textContent).toBe("gene");
    expect(screen.getByTestId("options-Metric").textContent).toBe(
      "coverage,depth",
    );
  });

  it("notifies the parent when a different option is picked", () => {
    const { onSelectedOptionsChange } = renderControls();
    fireEvent.click(screen.getByTestId("pick-Metric-depth"));
    expect(onSelectedOptionsChange).toHaveBeenCalledWith({ metric: "depth" });
  });

  it("does not notify the parent when the already-selected option is picked", () => {
    const { onSelectedOptionsChange } = renderControls();
    fireEvent.click(screen.getByTestId("pick-Metric-coverage"));
    expect(onSelectedOptionsChange).not.toHaveBeenCalled();
  });

  it("keys the callback by the control it came from", () => {
    const { onSelectedOptionsChange } = renderControls();
    fireEvent.click(screen.getByTestId("pick-View Level-allele"));
    expect(onSelectedOptionsChange).toHaveBeenCalledWith({
      viewLevel: "allele",
    });
    expect(onSelectedOptionsChange).toHaveBeenCalledTimes(1);
  });

  it("renders the legend with the selected scale once the data is ready", () => {
    renderControls();
    const legend = screen.getByTestId("legend");
    expect(legend.textContent).toBe("symlog");
    expect(legend.getAttribute("data-min")).toBe("0");
    expect(legend.getAttribute("data-max")).toBe("100");
    expect(screen.getByTestId("disabled-Metric").textContent).toBe("false");
  });

  it("hides the legend and disables the dropdowns while data is loading", () => {
    renderControls({ isDataReady: false });
    expect(screen.queryByTestId("legend")).toBeNull();
    expect(screen.getByTestId("disabled-Metric").textContent).toBe("true");
    expect(screen.getByTestId("disabled-View Level").textContent).toBe("true");
  });

  it("renders no dropdowns for an empty control list but still shows the legend", () => {
    renderControls({ controls: [] });
    expect(screen.queryByTestId("dropdown-Metric")).toBeNull();
    expect(screen.getByTestId("legend")).toBeTruthy();
  });
});

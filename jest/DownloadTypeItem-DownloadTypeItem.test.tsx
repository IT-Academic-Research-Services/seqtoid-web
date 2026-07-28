// Frontend coverage: DownloadTypeItem is the heatmap download modal's radio row.
// It is almost all conditional rendering, so each branch gets both sides: the
// selected/unselected radio stage and row class, the optional file-type suffix,
// and the metric dropdown which only appears when the option HAS metric options
// AND the row is selected. The click handler forwarding the download type is
// asserted too.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@czi-sds/components", () => ({
  InputRadio: (props: $TSFixMe) => (
    <span data-testid="radio" data-stage={props.stage} />
  ),
}));

// The metric dropdown is covered by its own unit; here it only needs to prove
// it was mounted with the right wiring.
jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapDownloadModal/components/DownloadTypeItem/components/MetricDropdown",
  () => ({
    // Rendered as a div rather than a button: the real dropdown lives inside
    // the row's own <button>, and nesting buttons trips a React DOM warning.
    MetricDropdown: (props: $TSFixMe) => (
      <div
        data-testid="metric-dropdown"
        data-downloadtype={props.downloadType}
        data-selected={String(props.selectedMetricValue)}
        onClick={() => props.handleSelectMetric(props.downloadType, "NR.rpm")}
      >
        metric dropdown
      </div>
    ),
  }),
);

import { DownloadTypeItem } from "~/components/views/SamplesHeatmapView/components/SamplesHeatmapDownloadModal/components/DownloadTypeItem/DownloadTypeItem";
import { HeatmapDownloadType } from "~/components/views/SamplesHeatmapView/constants";

const optionWithMetrics = {
  category: "reports",
  description: "Combined microbiome file description",
  displayName: "Combined Microbiome File",
  fileTypeDisplay: ".biom",
  metricOptions: [
    { text: "NT rPM", value: "NT.rpm" },
    { text: "NR rPM", value: "NR.rpm" },
  ],
  type: HeatmapDownloadType.BIOM_FORMAT,
};

const optionWithoutMetrics = {
  category: "images",
  description: "Heatmap image description",
  displayName: "Heatmap Image",
  fileTypeDisplay: ".png",
  type: HeatmapDownloadType.PNG,
};

const renderItem = (overrides: $TSFixMe = {}) => {
  const props = {
    downloadOption: optionWithoutMetrics,
    handleSelectMetric: jest.fn(),
    isSelected: false,
    selectedMetricValue: "NT.rpm",
    setSelectedDownloadType: jest.fn(),
    ...overrides,
  };
  return { ...render(<DownloadTypeItem {...(props as $TSFixMe)} />), props };
};

describe("DownloadTypeItem", () => {
  it("shows the display name, description and file type suffix", () => {
    renderItem();
    expect(screen.getByText("Heatmap Image")).toBeTruthy();
    expect(screen.getByText(/Heatmap image description/)).toBeTruthy();
    expect(screen.getByText("(.png)")).toBeTruthy();
  });

  it("omits the file type suffix when the option has none", () => {
    renderItem({
      downloadOption: { ...optionWithoutMetrics, fileTypeDisplay: "" },
    });
    expect(screen.queryByText("(.png)")).toBeNull();
    expect(screen.getByText("Heatmap Image")).toBeTruthy();
  });

  it("renders an unchecked radio when the row is not selected", () => {
    renderItem({ isSelected: false });
    expect(screen.getByTestId("radio").getAttribute("data-stage")).toBe(
      "unchecked",
    );
  });

  it("renders a checked radio when the row is selected", () => {
    renderItem({ isSelected: true });
    expect(screen.getByTestId("radio").getAttribute("data-stage")).toBe(
      "checked",
    );
  });

  it("reports its download type upward when clicked", () => {
    const { props } = renderItem();
    fireEvent.click(screen.getByRole("button"));
    expect(props.setSelectedDownloadType).toHaveBeenCalledWith(
      HeatmapDownloadType.PNG,
    );
  });

  it("hides the metric dropdown for an option without metric options", () => {
    renderItem({ downloadOption: optionWithoutMetrics, isSelected: true });
    expect(screen.queryByTestId("metric-dropdown")).toBeNull();
  });

  it("hides the metric dropdown while a metric-bearing option is unselected", () => {
    renderItem({ downloadOption: optionWithMetrics, isSelected: false });
    expect(screen.queryByTestId("metric-dropdown")).toBeNull();
  });

  it("shows the metric dropdown only when a metric-bearing option is selected", () => {
    renderItem({
      downloadOption: optionWithMetrics,
      isSelected: true,
      selectedMetricValue: "NT.rpm",
    });
    const dropdown = screen.getByTestId("metric-dropdown");
    expect(dropdown.getAttribute("data-downloadtype")).toBe(
      HeatmapDownloadType.BIOM_FORMAT,
    );
    expect(dropdown.getAttribute("data-selected")).toBe("NT.rpm");
  });

  it("forwards metric selections from the dropdown to the parent handler", () => {
    const { props } = renderItem({
      downloadOption: optionWithMetrics,
      isSelected: true,
    });
    fireEvent.click(screen.getByTestId("metric-dropdown"));
    expect(props.handleSelectMetric).toHaveBeenCalledWith(
      HeatmapDownloadType.BIOM_FORMAT,
      "NR.rpm",
    );
  });
});

// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/
//   components/BulkDownloadModal/components/BulkDownloadModalOptions/components/
//   DownloadTypeOption/DownloadTypeOption.tsx
//
// DownloadTypeOption renders a single bulk-download radio option. It is nearly
// all conditional rendering: the file-type suffix, the Admin-Only / Beta status
// labels, the "biom" external-link blurb, the "Learn More" documentation link,
// and -- only when the option is selected -- the per-field editors plus a
// heatmap link for biom downloads. It also gates its onClick on disabled/type.
// The leaf BulkDownloadDataField child is stubbed so assertions land on this
// file's branch logic; the click callbacks are driven directly.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const _React: typeof React = React;

// The `~ui` webpack alias is matched before Jest's blanket scss->styleMock
// mapper, so this scss import has to be stubbed explicitly.
jest.mock("~ui/controls/link.scss", () => ({}), { virtual: true });

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions/components/BulkDownloadDataField",
  () => ({
    __esModule: true,
    BulkDownloadDataField: (props: $TSFixMe) => (
      <div data-testid="data-field" data-field-type={props.field?.type} />
    ),
  }),
);

import { DownloadTypeOption } from "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions/components/DownloadTypeOption/DownloadTypeOption";

const baseProps = () => ({
  backgroundOptions: [],
  handleHeatmapLink: jest.fn(),
  isDisabled: false,
  isSelected: false,
  metricsOptions: [],
  onSelectDownloadType: jest.fn(),
  onSelectField: jest.fn(),
  selectedDownloadTypeName: null,
  selectedFields: {},
  validObjectIds: new Set<number | string>([1, 2]),
});

const renderOption = (downloadType: $TSFixMe, overrides: $TSFixMe = {}) => {
  const props = { ...baseProps(), downloadType, ...overrides };
  const result = render(<DownloadTypeOption {...props} />);
  return { ...result, props };
};

describe("DownloadTypeOption rendering branches", () => {
  it("renders name, file-type suffix and both status labels", () => {
    const { container } = renderOption({
      type: "sample_metadata",
      display_name: "Sample Metadata",
      description: "All the metadata",
      file_type_display: ".csv",
      admin_only: true,
      required_allowed_feature: "beta_flag",
    });
    expect(container.textContent).toContain("Sample Metadata");
    expect(container.textContent).toContain("(.csv)");
    expect(container.textContent).toContain("Admin Only");
    expect(container.textContent).toContain("Beta");
    expect(container.textContent).toContain("All the metadata");
  });

  it("omits file-type suffix and status labels when not provided", () => {
    const { container } = renderOption({
      type: "reads_non_host",
      display_name: "Reads",
      description: "read data",
    });
    expect(container.textContent).toContain("Reads");
    expect(container.textContent).not.toContain("(");
    expect(container.textContent).not.toContain("Admin Only");
    expect(container.textContent).not.toContain("Beta");
  });

  it("renders the BIOM external-link blurb for biom_format", () => {
    const { container } = renderOption({
      type: "biom_format",
      display_name: "BIOM",
      description: "biom desc",
    });
    expect(container.textContent).toContain("BIOM");
    expect(container.textContent).toContain("MicrobiomeDB");
  });

  it("renders a Learn More documentation link when the type has one", () => {
    renderOption({
      type: "biom_format",
      display_name: "BIOM",
      description: "biom desc",
    });
    expect(screen.getByText("Learn More")).toBeTruthy();
  });

  it("does not render a Learn More link for an undocumented type", () => {
    renderOption({
      type: "reads_non_host",
      display_name: "Reads",
      description: "read data",
    });
    expect(screen.queryByText("Learn More")).toBeNull();
  });
});

describe("DownloadTypeOption selected state", () => {
  it("renders the per-field editors only when selected and fields exist", () => {
    const { rerender } = render(
      <DownloadTypeOption
        {...baseProps()}
        downloadType={{
          type: "reads_non_host",
          display_name: "Reads",
          description: "d",
          fields: [{ type: "taxa_with_reads" }, { type: "file_format" }],
        }}
        isSelected={false}
      />,
    );
    // Not selected -> no data fields.
    expect(screen.queryAllByTestId("data-field")).toHaveLength(0);

    rerender(
      <DownloadTypeOption
        {...baseProps()}
        downloadType={{
          type: "reads_non_host",
          display_name: "Reads",
          description: "d",
          fields: [{ type: "taxa_with_reads" }, { type: "file_format" }],
        }}
        isSelected={true}
      />,
    );
    expect(screen.queryAllByTestId("data-field")).toHaveLength(2);
  });

  it("renders the heatmap link for a selected biom_format option", () => {
    const handleHeatmapLink = jest.fn();
    const { container } = renderOption(
      {
        type: "biom_format",
        display_name: "BIOM",
        description: "d",
        fields: [{ type: "metric" }],
      },
      { isSelected: true, handleHeatmapLink },
    );
    const heatmap = screen.getByText("heatmap");
    expect(container.textContent).toContain("download directly from");
    fireEvent.click(heatmap);
    expect(handleHeatmapLink).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(heatmap);
    expect(handleHeatmapLink).toHaveBeenCalledTimes(2);
  });

  it("does not render a heatmap link for a selected non-biom option", () => {
    renderOption(
      {
        type: "reads_non_host",
        display_name: "Reads",
        description: "d",
        fields: [{ type: "file_format" }],
      },
      { isSelected: true },
    );
    expect(screen.queryByText("heatmap")).toBeNull();
  });
});

describe("DownloadTypeOption click behaviour", () => {
  it("selects the type on click when enabled", () => {
    const onSelectDownloadType = jest.fn();
    const { container } = renderOption(
      { type: "reads_non_host", display_name: "Reads", description: "d" },
      { onSelectDownloadType },
    );
    fireEvent.click(container.firstChild as Element);
    expect(onSelectDownloadType).toHaveBeenCalledWith("reads_non_host");
  });

  it("does nothing on click when disabled", () => {
    const onSelectDownloadType = jest.fn();
    const { container } = renderOption(
      { type: "reads_non_host", display_name: "Reads", description: "d" },
      { onSelectDownloadType, isDisabled: true },
    );
    fireEvent.click(container.firstChild as Element);
    expect(onSelectDownloadType).not.toHaveBeenCalled();
  });

  it("does nothing on click when the download type has no type string", () => {
    const onSelectDownloadType = jest.fn();
    const { container } = renderOption(
      { display_name: "No Type", description: "d" },
      { onSelectDownloadType },
    );
    fireEvent.click(container.firstChild as Element);
    expect(onSelectDownloadType).not.toHaveBeenCalled();
  });
});

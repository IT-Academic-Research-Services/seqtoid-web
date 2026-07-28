// Frontend coverage: BenchmarkDownloadDropdown renders the benchmark download
// menu and routes selections to a location redirect. DownloadButtonDropdown is
// stubbed so the built items array is inspectable and `onClick` can be driven
// directly, covering the readyToDownload gate plus all three switch arms
// (report_html, report_ipynb and the no-op default).
import { render, screen } from "@testing-library/react";

let dropdownProps: $TSFixMe;

jest.mock("~/components/ui/controls/dropdowns", () => ({
  DownloadButtonDropdown: (props: $TSFixMe) => {
    dropdownProps = props;
    return <div data-testid="download-dropdown" />;
  },
}));

// semantic-ui-react's Dropdown.Item is only used as an element factory here --
// the stubbed dropdown never renders the items -- so a light stand-in keeps the
// props (key/onClick/className/children) inspectable.
jest.mock("semantic-ui-react", () => ({
  Dropdown: {
    Item: (props: $TSFixMe) => <div {...props} />,
  },
}));

import { BenchmarkDownloadDropdown } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/BenchmarkDownloadDropdown/BenchmarkDownloadDropdown";

const baseProps = {
  className: "bench-dd",
  readyToDownload: true,
  workflowRun: { id: 42 } as $TSFixMe,
};

const renderDropdown = (overrides: $TSFixMe = {}) =>
  render(<BenchmarkDownloadDropdown {...baseProps} {...overrides} />);

beforeEach(() => {
  jest.clearAllMocks();
  dropdownProps = undefined;
  delete (window as $TSFixMe).location;
  (window as $TSFixMe).location = { href: "" };
});

describe("BenchmarkDownloadDropdown", () => {
  it("renders nothing when the run is not ready to download", () => {
    const { container } = renderDropdown({ readyToDownload: false });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("download-dropdown")).toBeNull();
  });

  it("renders nothing when readyToDownload is omitted entirely", () => {
    const { container } = renderDropdown({ readyToDownload: undefined });
    expect(container.firstChild).toBeNull();
  });

  it("renders a left-opening dropdown carrying the className through", () => {
    renderDropdown();
    expect(screen.getByTestId("download-dropdown")).toBeTruthy();
    expect(dropdownProps.className).toBe("bench-dd");
    expect(dropdownProps.direction).toBe("left");
    expect(typeof dropdownProps.onClick).toBe("function");
  });

  it("builds one item per benchmark download format", () => {
    renderDropdown();
    expect(dropdownProps.items).toHaveLength(2);
    expect(dropdownProps.items.map((item: $TSFixMe) => item.key)).toEqual([
      "download_benchmarks",
      "download_notebook",
    ]);
    expect(
      dropdownProps.items.map((item: $TSFixMe) => item.props.children),
    ).toEqual([
      "Download Benchmarks (.html)",
      "Download Jupyter Notebook (.ipynb)",
    ]);
  });

  it("redirects to the html report for the benchmarks option", () => {
    renderDropdown();
    dropdownProps.onClick("download_benchmarks");
    expect(window.location.href).toBe(
      "/workflow_runs/42/benchmark_report_downloads?downloadType=report_html",
    );
  });

  it("redirects to the notebook report for the notebook option", () => {
    renderDropdown();
    dropdownProps.onClick("download_notebook");
    expect(window.location.href).toBe(
      "/workflow_runs/42/benchmark_report_downloads?downloadType=report_ipynb",
    );
  });

  it("does nothing for an unrecognized option", () => {
    renderDropdown();
    dropdownProps.onClick("something_else");
    expect(window.location.href).toBe("");
  });

  it("routes an item's own onClick through the same handler", () => {
    renderDropdown({ workflowRun: { id: 7 } });
    // Each item closes over its value, so invoking the second item's handler
    // must produce the notebook URL for run 7.
    dropdownProps.items[1].props.onClick();
    expect(window.location.href).toBe(
      "/workflow_runs/7/benchmark_report_downloads?downloadType=report_ipynb",
    );
  });
});

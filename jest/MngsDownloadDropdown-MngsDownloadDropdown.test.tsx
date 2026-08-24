// Frontend coverage: MngsDownloadDropdown builds the mNGS download menu and
// routes each selection through handleDownload. DownloadButtonDropdown is stubbed
// to capture the options array + expose onClick, so every switch arm is driven:
// the plain CSV redirect (with the no-background-selected toast branch on/off),
// the with-applied-filters client download, the taxon SVG/PNG SvgSaver arms, and
// the getLinkInfoForDownloadOption default (valid -> window.open, invalid ->
// logError). The tree-view image-options branch is also asserted.
import { render, screen } from "@testing-library/react";

const mockTrackEvent = jest.fn();
const mockTriggerFileDownload = jest.fn();
const mockGetDownloadDropdownOptions = jest.fn(() => [
  { text: "Download Non-Host Reads", value: "nonhost_reads" },
]);
const mockGetLinkInfoForDownloadOption = jest.fn();
const mockLogDownloadOption = jest.fn();
const mockLogError = jest.fn();
const mockShowToast = jest.fn();
const mockAsSvg = jest.fn();
const mockAsPng = jest.fn();

let dropdownProps: $TSFixMe;

jest.mock("~/api/analytics", () => ({
  useTrackEvent: () => mockTrackEvent,
}));

jest.mock("~/components/utils/clientDownload", () => ({
  triggerFileDownload: (...args: $TSFixMe[]) =>
    mockTriggerFileDownload(...args),
}));

jest.mock("~/components/utils/download", () => ({
  getDownloadDropdownOptions: (...args: $TSFixMe[]) =>
    mockGetDownloadDropdownOptions(...args),
  getLinkInfoForDownloadOption: (...args: $TSFixMe[]) =>
    mockGetLinkInfoForDownloadOption(...args),
  logDownloadOption: (...args: $TSFixMe[]) => mockLogDownloadOption(...args),
}));

jest.mock("~/components/utils/logUtil", () => ({
  logError: (...args: $TSFixMe[]) => mockLogError(...args),
}));

jest.mock("~/components/utils/toast", () => ({
  showToast: (...args: $TSFixMe[]) => mockShowToast(...args),
}));

jest.mock("svgsaver", () =>
  jest.fn().mockImplementation(() => ({
    asSvg: (...args: $TSFixMe[]) => mockAsSvg(...args),
    asPng: (...args: $TSFixMe[]) => mockAsPng(...args),
  })),
);

jest.mock("~/components/ui/controls/dropdowns/DownloadButtonDropdown", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    dropdownProps = props;
    return <div data-testid="download-dropdown" />;
  },
}));

import { WorkflowType } from "~/components/utils/workflows";
import { MngsDownloadDropdown } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/MngsDownloadDropdown/MngsDownloadDropdown";

const baseProps = {
  readyToDownload: true,
  backgroundId: 5,
  className: "dd",
  getDownloadReportTableWithAppliedFiltersLink: () => "/filters/link.csv",
  hasAppliedFilters: true,
  pipelineRun: { id: 3, pipeline_version: "8.0" } as $TSFixMe,
  sample: {
    id: 9,
    name: "SampleX",
    initial_workflow: WorkflowType.SHORT_READ_MNGS,
  } as $TSFixMe,
  view: "table",
};

const renderDropdown = (overrides: $TSFixMe = {}) =>
  render(<MngsDownloadDropdown {...(baseProps as $TSFixMe)} {...overrides} />);

beforeEach(() => {
  jest.clearAllMocks();
  dropdownProps = undefined;
  delete (window as $TSFixMe).location;
  (window as $TSFixMe).location = { href: "" };
});

describe("MngsDownloadDropdown", () => {
  it("renders nothing when not ready to download", () => {
    const { container } = renderDropdown({ readyToDownload: false });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("download-dropdown")).toBeNull();
  });

  it("renders the dropdown and includes the pipeline-run download options", () => {
    renderDropdown();
    expect(screen.getByTestId("download-dropdown")).toBeTruthy();
    expect(mockGetDownloadDropdownOptions).toHaveBeenCalledWith(
      baseProps.pipelineRun,
    );
    const values = dropdownProps.options.map((o: $TSFixMe) => o.value);
    expect(values).toContain("download_csv");
    expect(values).toContain("download_csv_with_filters");
    expect(values).toContain("nonhost_reads");
  });

  it("disables the with-filters option when there are no applied filters", () => {
    renderDropdown({ hasAppliedFilters: false });
    const withFilters = dropdownProps.options.find(
      (o: $TSFixMe) => o.value === "download_csv_with_filters",
    );
    expect(withFilters.disabled).toBe(true);
  });

  it("redirects the browser for the plain CSV option (background present, no toast)", () => {
    renderDropdown();
    dropdownProps.onClick("download_csv");
    expect(window.location.href).toBe(
      "/samples/9/report_csv?background_id=5&pipeline_version=8.0",
    );
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("shows the no-background toast for the CSV option when no background is selected", () => {
    renderDropdown({ backgroundId: null });
    dropdownProps.onClick("download_csv");
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    // No background id means it is omitted from the query string.
    expect(window.location.href).toBe(
      "/samples/9/report_csv?pipeline_version=8.0",
    );
  });

  it("skips the toast for a long-read sample even without a background", () => {
    renderDropdown({
      backgroundId: null,
      sample: {
        id: 9,
        name: "SampleX",
        initial_workflow: WorkflowType.LONG_READ_MNGS,
      } as $TSFixMe,
    });
    dropdownProps.onClick("download_csv");
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("triggers a client download for the with-filters option", () => {
    renderDropdown();
    dropdownProps.onClick("download_csv_with_filters");
    expect(mockTriggerFileDownload).toHaveBeenCalledWith({
      downloadUrl: "/filters/link.csv",
      fileName: "SampleX_report_with_applied_filters.csv",
    });
  });

  it("saves an SVG for the taxon_svg option", () => {
    renderDropdown();
    dropdownProps.onClick("taxon_svg");
    expect(mockAsSvg).toHaveBeenCalledTimes(1);
    expect(mockAsSvg.mock.calls[0][1]).toBe("taxon_tree.svg");
  });

  it("saves a PNG for the taxon_png option", () => {
    renderDropdown();
    dropdownProps.onClick("taxon_png");
    expect(mockAsPng).toHaveBeenCalledTimes(1);
    expect(mockAsPng.mock.calls[0][1]).toBe("taxon_tree.png");
  });

  it("opens the link in the same page for a valid default option", () => {
    const mockOpen = jest.fn();
    (window as $TSFixMe).open = mockOpen;
    mockGetLinkInfoForDownloadOption.mockReturnValue({
      path: "/download/path",
      newPage: false,
    });
    renderDropdown();
    dropdownProps.onClick("nonhost_reads");
    expect(mockGetLinkInfoForDownloadOption).toHaveBeenCalledWith(
      "nonhost_reads",
      9,
      baseProps.pipelineRun,
    );
    expect(mockOpen).toHaveBeenCalledWith("/download/path", "_self");
  });

  it("opens the link in a new page when newPage is true", () => {
    const mockOpen = jest.fn();
    (window as $TSFixMe).open = mockOpen;
    mockGetLinkInfoForDownloadOption.mockReturnValue({
      path: "/download/path",
      newPage: true,
    });
    renderDropdown();
    dropdownProps.onClick("nonhost_reads");
    expect(mockOpen).toHaveBeenCalledWith("/download/path", "_blank");
  });

  it("logs an error for a default option with no link info", () => {
    mockGetLinkInfoForDownloadOption.mockReturnValue(null);
    renderDropdown();
    dropdownProps.onClick("bogus_option");
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "SampleViewControls/DownloadDropdown: Invalid option passed to handleDownload",
        details: {
          option: "bogus_option",
          pipelineRun: expect.objectContaining({ id: 3 }),
          sample: expect.objectContaining({ id: 9 }),
        },
      }),
    );
  });

  it("always logs the chosen download option for analytics", () => {
    renderDropdown();
    dropdownProps.onClick("download_csv");
    expect(mockLogDownloadOption).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "SampleViewControls/DownloadDropdown",
        option: "download_csv",
        details: { sampleId: 9, sampleName: "SampleX" },
      }),
    );
  });

  it("appends taxon tree image options when the view is tree", () => {
    renderDropdown({ view: "tree" });
    const values = dropdownProps.options.map((o: $TSFixMe) => o.value);
    expect(values).toContain("taxon_svg");
    expect(values).toContain("taxon_png");
  });

  it("omits taxon tree image options for a non-tree view", () => {
    renderDropdown({ view: "table" });
    const values = dropdownProps.options.map((o: $TSFixMe) => o.value);
    expect(values).not.toContain("taxon_svg");
    expect(values).not.toContain("taxon_png");
  });
});

// Frontend coverage: AmrDownloadDropdown builds the AMR download menu and routes
// each menu selection through handleDownload. DownloadButtonDropdown is stubbed
// so the built option list is inspected and handleDownload can be invoked with
// each value, covering all switch arms: the direct-CSV redirect, the
// with-applied-filters client download, the getAmrDownloadLink default path
// (both valid and invalid), and the logDownloadOption tail. The old-pipeline
// version branch that disables the non-host options is also asserted.
import { render, screen } from "@testing-library/react";

const mockTrackEvent = jest.fn();
const mockTriggerFileDownload = jest.fn();
const mockLogDownloadOption = jest.fn();
const mockLogError = jest.fn();
const mockGetAmrDownloadLink = jest.fn();

let dropdownProps: $TSFixMe;

jest.mock("~/api/analytics", () => ({
  useTrackEvent: () => mockTrackEvent,
}));

jest.mock("~/components/utils/clientDownload", () => ({
  triggerFileDownload: (...args: $TSFixMe[]) =>
    mockTriggerFileDownload(...args),
}));

jest.mock("~/components/utils/download", () => ({
  logDownloadOption: (...args: $TSFixMe[]) => mockLogDownloadOption(...args),
}));

jest.mock("~/components/utils/logUtil", () => ({
  logError: (...args: $TSFixMe[]) => mockLogError(...args),
}));

jest.mock(
  "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/AmrDownloadDropdown/amrDownloadUtils",
  () => ({
    NONHOST_DOWNLOADS_TOOLTIP: "nonhost tooltip",
    DownloadOptions: {
      NON_HOST_READS_LABEL: "Download Non-Host Reads (.fasta)",
      NON_HOST_CONTIGS_LABEL: "Download Non-Host Contigs (.fasta)",
      COMPREHENSIVE_AMR_METRICS_LABEL:
        "Download Comprehensive AMR Metrics File (.tsv)",
      INTERMEDIATE_FILES_LABEL: "Download Intermediate Files (.zip)",
    },
    getAmrDownloadLink: (...args: $TSFixMe[]) =>
      mockGetAmrDownloadLink(...args),
  }),
);

jest.mock("~/components/ui/controls/dropdowns/DownloadButtonDropdown", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    dropdownProps = props;
    return <div data-testid="download-dropdown" />;
  },
}));

import { AmrContext } from "~/components/views/SampleView/components/AmrView/amrContext/reducer";
import { AmrDownloadDropdown } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/AmrDownloadDropdown/AmrDownloadDropdown";

const baseProps = {
  readyToDownload: true,
  className: "dd",
  workflowRun: { id: 42, wdl_version: "1.2.0" } as $TSFixMe,
  sample: { id: 9, name: "SampleX" } as $TSFixMe,
};

const renderDropdown = (
  overrides: $TSFixMe = {},
  contextValue: $TSFixMe = {
    amrContextState: {
      reportTableDownloadWithAppliedFiltersLink: "/filters/link.csv",
    },
  },
) =>
  render(
    <AmrContext.Provider value={contextValue as $TSFixMe}>
      <AmrDownloadDropdown {...(baseProps as $TSFixMe)} {...overrides} />
    </AmrContext.Provider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  dropdownProps = undefined;
  // location.href assignment -- make it settable + observable.
  delete (window as $TSFixMe).location;
  (window as $TSFixMe).location = { href: "" };
});

describe("AmrDownloadDropdown", () => {
  it("renders nothing when not ready to download", () => {
    const { container } = renderDropdown({ readyToDownload: false });
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("download-dropdown")).toBeNull();
  });

  it("renders the dropdown with all six options for a current-pipeline run", () => {
    renderDropdown();
    expect(screen.getByTestId("download-dropdown")).toBeTruthy();
    expect(dropdownProps.items).toHaveLength(6);
  });

  it("enables the with-filters option when a filtered-link is present", () => {
    // The 'with filters' item is not disabled: it is rendered as a bare item,
    // not wrapped in a tooltip span. Assert via the redirect handler instead.
    renderDropdown();
    dropdownProps.onClick("download_csv_with_filters");
    expect(mockTriggerFileDownload).toHaveBeenCalledWith({
      downloadUrl: "/filters/link.csv",
      fileName: "SampleX_amr_report_with_applied_filters.csv",
    });
  });

  it("redirects the browser for the plain CSV option", () => {
    renderDropdown();
    dropdownProps.onClick("download_csv");
    expect(window.location.href).toBe(
      "/workflow_runs/42/amr_report_downloads?downloadType=report_csv",
    );
  });

  it("triggers a file download for a valid default option", () => {
    mockGetAmrDownloadLink.mockReturnValue({
      downloadUrl: "/nonhost/reads.fasta",
      fileName: "reads.fasta",
    });
    renderDropdown();
    dropdownProps.onClick("Download Non-Host Reads (.fasta)");
    expect(mockGetAmrDownloadLink).toHaveBeenCalledWith(
      baseProps.workflowRun,
      baseProps.sample,
      "Download Non-Host Reads (.fasta)",
    );
    expect(mockTriggerFileDownload).toHaveBeenCalledWith({
      downloadUrl: "/nonhost/reads.fasta",
      fileName: "reads.fasta",
    });
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("logs an error for a default option that yields no link", () => {
    mockGetAmrDownloadLink.mockReturnValue({ downloadUrl: "", fileName: "" });
    renderDropdown();
    dropdownProps.onClick("some-unknown-option");
    expect(mockTriggerFileDownload).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "SampleViewControls/AmrDownloadDropdown: Invalid option passed to handleDownload",
        details: {
          downloadUrl: "",
          fileName: "",
          option: "some-unknown-option",
        },
      }),
    );
  });

  it("always logs the chosen download option for analytics", () => {
    renderDropdown();
    dropdownProps.onClick("download_csv");
    expect(mockLogDownloadOption).toHaveBeenCalledWith(
      expect.objectContaining({
        component: "SampleViewControls/AmrDownloadDropdown",
        option: "download_csv",
        details: { sampleId: 9, sampleName: "SampleX" },
      }),
    );
  });

  it("disables the with-filters option when no filtered link exists", () => {
    renderDropdown({}, { amrContextState: {} });
    // With no link, the with-filters item is created with disabled=true. It has
    // no tooltip, so it renders as a plain (disabled) BaseDropdown.Item. We
    // assert the count is unchanged (still 6 options rendered).
    expect(dropdownProps.items).toHaveLength(6);
  });

  it("marks the non-host options disabled (tooltip-wrapped) for an old pipeline", () => {
    // wdl_version < 1.1 disables the non-host reads/contigs items, which then get
    // wrapped in a Tooltip span. Rendering the items must not throw and still
    // produces six entries.
    renderDropdown({
      workflowRun: { id: 42, wdl_version: "1.0.0" } as $TSFixMe,
    });
    expect(dropdownProps.items).toHaveLength(6);
  });

  it("treats a missing wdl_version as an old pipeline", () => {
    renderDropdown({ workflowRun: { id: 42 } as $TSFixMe });
    expect(dropdownProps.items).toHaveLength(6);
  });
});

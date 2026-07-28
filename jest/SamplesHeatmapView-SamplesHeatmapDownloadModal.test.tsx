// Coverage: app/assets/src/components/views/SamplesHeatmapView/components/SamplesHeatmapDownloadModal/SamplesHeatmapDownloadModal.tsx
//
// The download modal maps a selected "download type" onto one of five actions:
// the svg/png image exports, the two CSV report exports (one of which routes
// through triggerFileDownload) and the async BIOM bulk-download submission. It
// also owns the enable/disable rules for the primary button and the sample-count
// pluralization in the header. DownloadTypeItem, the SDS Modal, the bulk-download
// API and the file-download helper are all stubbed so each dispatch branch and
// guard can be exercised directly.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SamplesHeatmapDownloadModal } from "~/components/views/SamplesHeatmapView/components/SamplesHeatmapDownloadModal/SamplesHeatmapDownloadModal";

const mockCreateBulkDownload = jest.fn();
const mockTriggerFileDownload = jest.fn();
const mockTrackEvent = jest.fn();

jest.mock("~/api/bulk_downloads", () => ({
  createBulkDownload: (...args: unknown[]) => mockCreateBulkDownload(...args),
}));

jest.mock("~/components/utils/clientDownload", () => ({
  triggerFileDownload: (...args: unknown[]) => mockTriggerFileDownload(...args),
}));

jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: {
    SAMPLES_HEATMAP_DOWNLOAD_MODAL_BULK_DOWNLOAD_CREATION_SUCCESS: "bd-success",
    SAMPLES_HEATMAP_DOWNLOAD_MODAL_BULK_DOWNLOAD_CREATION_SUCCESS_ALLISON_TESTING:
      "bd-success-allison",
  },
  useTrackEvent: () => mockTrackEvent,
}));

// The SDS modal container just renders its children when open.
jest.mock("~/components/ui/containers/Modal", () => ({
  __esModule: true,
  default: ({ children, open }: $TSFixMe) =>
    open ? <div>{children}</div> : null,
}));

// Stub the download-type row: expose one button to select the type and, when a
// metric setter is present (the BIOM row), a button to set a metric value.
jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapDownloadModal/components/DownloadTypeItem",
  () => ({
    DownloadTypeItem: (props: $TSFixMe) => (
      <li>
        <button
          data-testid={`select-${props.downloadOption.type}`}
          onClick={() =>
            props.setSelectedDownloadType(props.downloadOption.type)
          }
        >
          select {props.downloadOption.type}
        </button>
        {props.handleSelectMetric && (
          <button
            data-testid={`metric-${props.downloadOption.type}`}
            onClick={() =>
              props.handleSelectMetric(props.downloadOption.type, "NT.rpm")
            }
          >
            set metric
          </button>
        )}
        <span data-testid={`isSelected-${props.downloadOption.type}`}>
          {String(props.isSelected)}
        </span>
      </li>
    ),
  }),
);

const baseProps = () => ({
  onClose: jest.fn(),
  onGenerateBulkDownload: jest.fn(),
  open: true,
  sampleIds: [1, 2, 3],
  heatmapParams: {
    thresholdFilters: [],
    categories: ["Viruses"],
    background: 26,
  } as $TSFixMe,
  onDownloadSvg: jest.fn(),
  onDownloadPng: jest.fn(),
  onDownloadAllHeatmapMetricsCsv: jest.fn(),
  onDownloadCurrentHeatmapViewCsv: jest.fn(
    () => "http://example.test/view.csv",
  ),
});

const renderModal = (overrides: $TSFixMe = {}) => {
  const props = { ...baseProps(), ...overrides };
  return { props, ...render(<SamplesHeatmapDownloadModal {...props} />) };
};

const downloadButton = () =>
  screen.getByText(/^(Download|Start Generating Download)$/).closest("button")!;

describe("SamplesHeatmapDownloadModal", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders nothing when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByText("Select a Download Type")).toBeNull();
  });

  it("pluralizes the sample count (plural)", () => {
    renderModal({ sampleIds: [1, 2, 3] });
    expect(screen.getByText("3 samples selected")).toBeTruthy();
  });

  it("uses the singular sample count for a single sample", () => {
    renderModal({ sampleIds: [7] });
    expect(screen.getByText("1 sample selected")).toBeTruthy();
  });

  it("disables the download button until a type is selected", () => {
    renderModal();
    expect(downloadButton().disabled).toBe(true);
  });

  it("dispatches the SVG image download", () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByTestId("select-svg"));
    fireEvent.click(downloadButton());
    expect(props.onDownloadSvg).toHaveBeenCalledTimes(1);
  });

  it("dispatches the PNG image download", () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByTestId("select-png"));
    fireEvent.click(downloadButton());
    expect(props.onDownloadPng).toHaveBeenCalledTimes(1);
  });

  it("dispatches the all-metrics CSV download", () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByTestId("select-all_metrics"));
    fireEvent.click(downloadButton());
    expect(props.onDownloadAllHeatmapMetricsCsv).toHaveBeenCalledTimes(1);
  });

  it("routes the current-metrics CSV through triggerFileDownload", () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByTestId("select-current_metrics"));
    fireEvent.click(downloadButton());
    expect(props.onDownloadCurrentHeatmapViewCsv).toHaveBeenCalled();
    expect(mockTriggerFileDownload).toHaveBeenCalledWith({
      downloadUrl: "http://example.test/view.csv",
      fileName: "current_heatmap_view.csv",
    });
  });

  it("keeps BIOM disabled until a metric is chosen, then submits a bulk download", async () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByTestId("select-biom_format"));

    // The label switches and the button stays disabled without a metric.
    expect(screen.getByText("Start Generating Download")).toBeTruthy();
    expect(
      screen.getByText(
        "Downloads for larger files can take multiple hours to generate.",
      ),
    ).toBeTruthy();
    expect(downloadButton().disabled).toBe(true);

    // Choose the BIOM metric -> button enables.
    fireEvent.click(screen.getByTestId("metric-biom_format"));
    expect(downloadButton().disabled).toBe(false);

    mockCreateBulkDownload.mockResolvedValueOnce(undefined);
    fireEvent.click(downloadButton());

    await waitFor(() =>
      expect(mockCreateBulkDownload).toHaveBeenCalledTimes(1),
    );
    const submission = mockCreateBulkDownload.mock.calls[0][0];
    expect(submission.downloadType).toBe("biom_format");
    expect(submission.validObjectIds).toEqual([1, 2, 3]);
    expect(submission.fields.metric.value).toBe("NT.rpm");
    expect(submission.fields.background.value).toBe(26);
    expect(props.onGenerateBulkDownload).toHaveBeenCalledTimes(1);
    // success analytics fired after the API resolves
    await waitFor(() =>
      expect(mockTrackEvent).toHaveBeenCalledWith(
        "bd-success",
        expect.anything(),
      ),
    );
  });

  it("logs an error and does not throw when the bulk download API fails", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { props } = renderModal();
    fireEvent.click(screen.getByTestId("select-biom_format"));
    fireEvent.click(screen.getByTestId("metric-biom_format"));

    mockCreateBulkDownload.mockRejectedValueOnce(new Error("boom"));
    fireEvent.click(downloadButton());

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    // The modal still closes even on failure (onGenerateBulkDownload is fire-and-forget).
    expect(props.onGenerateBulkDownload).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

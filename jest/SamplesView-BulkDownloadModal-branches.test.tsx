// Branch coverage for
// app/assets/src/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/BulkDownloadModal.tsx
//
// The happy paths of this modal are already covered elsewhere; this file walks
// the remaining fallback arms: the `|| DEFAULT_CREATION_ERROR` fallbacks on the
// overview query error, the sample-metadata CSV write, the sample-metadata API
// response and `onCreateDownloadError` itself, the `?? []` fallback when the
// Rails validator omits invalid sample names, the implicit else when the
// workflow entity is neither samples nor workflow runs, and the heatmap link
// when the selected metric is one the heatmap can sort on.
import { act, render, screen, waitFor } from "@testing-library/react";
import { UserContext } from "~/components/common/UserContext";
import { WORKFLOW_ENTITIES, WorkflowType } from "~/components/utils/workflows";
import { BulkDownloadModal } from "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/BulkDownloadModal";

/* eslint-disable @typescript-eslint/no-explicit-any */

const mockCommitMutation = jest.fn();
const mockFetchQuery = jest.fn();
const mockGetBulkDownloadTypes = jest.fn();
const mockGetBulkDownloadMetrics = jest.fn();
const mockCreateBulkDownload = jest.fn();
const mockCreateSampleMetadataBulkDownload = jest.fn();
const mockGetBackgrounds = jest.fn();
const mockGetMassNormalizedBackgroundAvailability = jest.fn();
const mockUserIsCollaboratorOnAllSamples = jest.fn();
const mockSamplesUploadedByCurrentUser = jest.fn();
const mockWorkflowRunsCreatedByCurrentUser = jest.fn();
const mockValidateSampleIds = jest.fn();
const mockValidateWorkflowRunIds = jest.fn();
const mockDownloadFileFromCSV = jest.fn();
const mockOpenUrlInNewTab = jest.fn();
const mockTrackEvent = jest.fn();

jest.mock("react-relay", () => ({
  useMutation: () => [(config: unknown) => mockCommitMutation(config), false],
  useRelayEnvironment: () => ({ name: "test-environment" }),
}));

jest.mock("relay-runtime", () => ({
  ...jest.requireActual("relay-runtime"),
  fetchQuery: (...args: unknown[]) => mockFetchQuery(...args),
}));

jest.mock("~/api", () => ({
  getBackgrounds: (...a: unknown[]) => mockGetBackgrounds(...a),
  getMassNormalizedBackgroundAvailability: (...a: unknown[]) =>
    mockGetMassNormalizedBackgroundAvailability(...a),
  userIsCollaboratorOnAllSamples: (...a: unknown[]) =>
    mockUserIsCollaboratorOnAllSamples(...a),
  samplesUploadedByCurrentUser: (...a: unknown[]) =>
    mockSamplesUploadedByCurrentUser(...a),
  workflowRunsCreatedByCurrentUser: (...a: unknown[]) =>
    mockWorkflowRunsCreatedByCurrentUser(...a),
}));

jest.mock("~/api/access_control", () => ({
  validateSampleIds: (...a: unknown[]) => mockValidateSampleIds(...a),
  validateWorkflowRunIds: (...a: unknown[]) => mockValidateWorkflowRunIds(...a),
}));

jest.mock("~/api/bulk_downloads", () => ({
  createBulkDownload: (...a: unknown[]) => mockCreateBulkDownload(...a),
  createSampleMetadataBulkDownload: (...a: unknown[]) =>
    mockCreateSampleMetadataBulkDownload(...a),
  getBulkDownloadMetrics: (...a: unknown[]) => mockGetBulkDownloadMetrics(...a),
  getBulkDownloadTypes: (...a: unknown[]) => mockGetBulkDownloadTypes(...a),
}));

jest.mock("~/api/utils", () => ({
  getCsrfToken: () => "csrf-token",
}));

jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: {
    BULK_DOWNLOAD_MODAL_BULK_DOWNLOAD_CREATION_SUCCESSFUL:
      "bulk_download_creation_successful",
  },
  useTrackEvent:
    () =>
    (...a: unknown[]) =>
      mockTrackEvent(...a),
}));

jest.mock("~/components/utils/links", () => ({
  downloadFileFromCSV: (...a: unknown[]) => mockDownloadFileFromCSV(...a),
  openUrlInNewTab: (...a: unknown[]) => mockOpenUrlInNewTab(...a),
}));

jest.mock("~/components/ui/containers/Modal", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ children, open }: any) =>
      open ? ReactLib.createElement("div", null, children) : null,
  };
});

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions",
  () => {
    const ReactLib = require("react");
    return {
      BulkDownloadModalOptions: (props: any) =>
        ReactLib.createElement(
          "div",
          null,
          ReactLib.createElement(
            "span",
            { "data-testid": "options-state" },
            JSON.stringify({
              selectedDownloadTypeName: props.selectedDownloadTypeName,
              selectedFields: props.selectedFields,
            }),
          ),
          [
            "consensus_genome_overview",
            "sample_metadata",
            "reads_non_host",
          ].map(type =>
            ReactLib.createElement(
              "button",
              {
                key: type,
                "data-testid": `select-${type}`,
                onClick: () => props.onSelectDownloadType(type),
              },
              type,
            ),
          ),
          ReactLib.createElement(
            "button",
            {
              "data-testid": "set-sortable-metric",
              onClick: () =>
                props.onSelectField(
                  "biom_format",
                  "metric",
                  "NT.rpm",
                  "NT rPM",
                ),
            },
            "set sortable metric",
          ),
          ReactLib.createElement(
            "button",
            {
              "data-testid": "heatmap-link",
              onClick: () => props.handleHeatmapLink(),
            },
            "heatmap",
          ),
        ),
    };
  },
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalFooter",
  () => {
    const ReactLib = require("react");
    return {
      BulkDownloadModalFooter: (props: any) =>
        ReactLib.createElement(
          "div",
          null,
          ReactLib.createElement(
            "span",
            { "data-testid": "footer-state" },
            JSON.stringify({
              loading: props.loading,
              validObjectIds: Array.from(props.validObjectIds ?? []),
              invalidSampleNames: props.invalidSampleNames,
              validationError: props.validationError,
              waitingForCreate: props.waitingForCreate,
              createStatus: props.createStatus,
              createError: props.createError,
            }),
          ),
          ReactLib.createElement(
            "button",
            {
              "data-testid": "download",
              onClick: () => props.onDownloadRequest(["1", "2"]),
            },
            "download",
          ),
        ),
    };
  },
);

const DEFAULT_CREATION_ERROR =
  "An unknown error occurred. Please contact us for help.";

const footerState = () =>
  JSON.parse(screen.getByTestId("footer-state").textContent as string);

const selectedObjects = [
  { id: "1", host: "Human", sample: { id: "s1", name: "Sample One" } },
  { id: "2", host: "Mosquito", sample: { id: "s2", name: "Sample Two" } },
] as any[];

let cgOverviewObserver: any = null;

const defaultProps = {
  onClose: jest.fn(),
  onGenerate: jest.fn(),
  open: true,
  selectedObjects,
  selectedIds: new Set(["1", "2"]),
  workflow: WorkflowType.CONSENSUS_GENOME,
  workflowEntity: WORKFLOW_ENTITIES.WORKFLOW_RUNS,
};

const renderModal = async (props: Record<string, any> = {}) => {
  const merged = { ...defaultProps, ...props };
  const utils = render(
    <UserContext.Provider value={{ userId: 42 } as any}>
      <BulkDownloadModal {...(merged as any)} />
    </UserContext.Provider>,
  );
  await waitFor(() => expect(footerState().loading).toBe(false));
  return { ...utils, props: merged };
};

let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  cgOverviewObserver = null;
  consoleErrorSpy = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);

  mockGetBulkDownloadTypes.mockResolvedValue([
    { type: "sample_metadata" },
    { type: "reads_non_host" },
  ]);
  mockGetBulkDownloadMetrics.mockResolvedValue([]);
  mockGetBackgrounds.mockResolvedValue({ backgrounds: [] });
  mockGetMassNormalizedBackgroundAvailability.mockResolvedValue({
    massNormalizedBackgroundsAvailable: false,
  });
  mockUserIsCollaboratorOnAllSamples.mockResolvedValue(true);
  mockSamplesUploadedByCurrentUser.mockResolvedValue(true);
  mockWorkflowRunsCreatedByCurrentUser.mockResolvedValue(true);
  mockValidateSampleIds.mockResolvedValue({
    validIds: [1],
    invalidSampleNames: ["Sample Two"],
    error: null,
  });

  mockFetchQuery.mockImplementation(() => ({
    toPromise: () =>
      Promise.resolve({
        fedWorkflowRuns: [
          { id: "1", ownerUserId: 42, status: "SUCCEEDED" },
          { id: "2", ownerUserId: 42, status: "FAILED" },
        ],
      }),
    subscribe: (observer: any) => {
      cgOverviewObserver = observer;
      return { unsubscribe: jest.fn() };
    },
  }));
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("BulkDownloadModal error-message fallbacks", () => {
  it("falls back to the default error when the overview query error carries no message", async () => {
    await renderModal();
    act(() => {
      screen.getByTestId("select-consensus_genome_overview").click();
    });
    act(() => {
      screen.getByTestId("download").click();
    });

    expect(cgOverviewObserver).not.toBeNull();
    act(() => {
      cgOverviewObserver.error(new Error(""));
    });

    const footer = footerState();
    expect(footer.createStatus).toBe("error");
    expect(footer.createError).toBe(DEFAULT_CREATION_ERROR);
    expect(footer.waitingForCreate).toBe(false);
  });

  it("surfaces the thrown value when writing the metadata CSV fails", async () => {
    mockCreateSampleMetadataBulkDownload.mockResolvedValue({
      sample_metadata: [["header"]],
    });
    mockDownloadFileFromCSV.mockImplementationOnce(() => {
      throw "csv writer exploded";
    });
    const onClose = jest.fn();
    await renderModal({ onClose });

    act(() => {
      screen.getByTestId("select-sample_metadata").click();
    });
    await act(async () => {
      screen.getByTestId("download").click();
    });

    expect(footerState().createError).toBe("csv writer exploded");
    // The modal still closes even though the CSV write blew up.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default error when the metadata CSV write throws a falsy value", async () => {
    mockCreateSampleMetadataBulkDownload.mockResolvedValue({
      sample_metadata: [["header"]],
    });
    mockDownloadFileFromCSV.mockImplementationOnce(() => {
      throw undefined;
    });
    await renderModal();

    act(() => {
      screen.getByTestId("select-sample_metadata").click();
    });
    await act(async () => {
      screen.getByTestId("download").click();
    });

    expect(footerState().createError).toBe(DEFAULT_CREATION_ERROR);
  });

  it("falls back to the default error when the metadata response has neither rows nor an error", async () => {
    mockCreateSampleMetadataBulkDownload.mockResolvedValue({
      sample_metadata: null,
    });
    const onClose = jest.fn();
    await renderModal({ onClose });

    act(() => {
      screen.getByTestId("select-sample_metadata").click();
    });
    await act(async () => {
      screen.getByTestId("download").click();
    });

    expect(mockDownloadFileFromCSV).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(footerState().createError).toBe(DEFAULT_CREATION_ERROR);
  });

  it("falls back to the default error when createBulkDownload rejects without an error field", async () => {
    mockCreateBulkDownload.mockRejectedValue({});
    const onGenerate = jest.fn();
    await renderModal({ onGenerate });

    act(() => {
      screen.getByTestId("select-reads_non_host").click();
    });
    await act(async () => {
      screen.getByTestId("download").click();
    });

    expect(onGenerate).not.toHaveBeenCalled();
    expect(mockTrackEvent).not.toHaveBeenCalled();
    const footer = footerState();
    expect(footer.createStatus).toBe("error");
    expect(footer.createError).toBe(DEFAULT_CREATION_ERROR);
  });
});

describe("BulkDownloadModal validation fallbacks", () => {
  it("defaults to an empty invalid-name list when the Rails validator omits one", async () => {
    mockValidateSampleIds.mockResolvedValue({
      validIds: [1, 2],
      error: null,
    });
    await renderModal({
      workflow: WorkflowType.SHORT_READ_MNGS,
      workflowEntity: WORKFLOW_ENTITIES.SAMPLES,
    });

    const footer = footerState();
    expect(footer.validObjectIds).toEqual(["1", "2"]);
    expect(footer.invalidSampleNames).toEqual([]);
    expect(footer.validationError).toBeNull();
  });
});

describe("BulkDownloadModal object id labelling", () => {
  it("tracks no id field when the workflow entity is neither samples nor workflow runs", async () => {
    mockCreateBulkDownload.mockResolvedValue({});
    const onGenerate = jest.fn();
    await renderModal({ workflowEntity: undefined, onGenerate });

    act(() => {
      screen.getByTestId("select-reads_non_host").click();
    });
    await act(async () => {
      screen.getByTestId("download").click();
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      "bulk_download_creation_successful",
      {
        workflow: WorkflowType.CONSENSUS_GENOME,
        downloadType: "reads_non_host",
      },
    );
    const trackedPayload = mockTrackEvent.mock.calls[0][1];
    expect(trackedPayload).not.toHaveProperty("sampleIds");
    expect(trackedPayload).not.toHaveProperty("workflowRunIds");
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});

describe("BulkDownloadModal heatmap link", () => {
  it("adds the metric preset when the selected metric is heatmap-sortable", async () => {
    await renderModal();

    act(() => {
      screen.getByTestId("set-sortable-metric").click();
    });
    act(() => {
      screen.getByTestId("heatmap-link").click();
    });

    expect(mockOpenUrlInNewTab).toHaveBeenCalledTimes(1);
    const url = mockOpenUrlInNewTab.mock.calls[0][0] as string;
    // encodeURI escapes the array brackets getURLParamString emits.
    expect(url).toContain("presets%5B%5D=metric");
    // sortMetric is truthy, so the metric param rides along as true.
    expect(url).toContain("metric=true");
    // No filter_by selection means the threshold preset is not pushed.
    expect(url).not.toContain("thresholdFilters");
  });
});

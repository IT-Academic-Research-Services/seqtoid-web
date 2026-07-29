// Coverage for
// app/assets/src/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/BulkDownloadModal.tsx
// The modal is the orchestrator for bulk downloads: it fans out the option /
// validation fetches on mount, then routes a download request to one of four
// very different backends (Relay mutation, Relay CG-overview query, the Rails
// sample-metadata CSV endpoint, or the generic createBulkDownload call). Relay,
// the API layer and the two presentational children are stubbed so the routing
// and error handling this file owns are what is exercised.
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { UserContext } from "~/components/common/UserContext";
import { WORKFLOW_ENTITIES, WorkflowType } from "~/components/utils/workflows";
import { BulkDownloadModal } from "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/BulkDownloadModal";

// Keeps organize-imports from dropping the React import the classic JSX
// runtime needs in scope.
const _React: typeof React = React;

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

jest.mock("~/components/ui/containers/Modal", () => ({
  __esModule: true,
  default: ({ children, open }: any) => (open ? <div>{children}</div> : null),
}));

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
              downloadTypeCount: props.downloadTypes?.length ?? null,
              backgroundOptionCount: props.backgroundOptions?.length ?? null,
              metricsOptionCount: props.metricsOptions?.length ?? null,
              areAllObjectsUploadedByCurrentUser:
                props.areAllObjectsUploadedByCurrentUser,
              isUserCollaboratorOnAllRequestedSamples:
                props.isUserCollaboratorOnAllRequestedSamples,
              enableMassNormalizedBackgrounds:
                props.enableMassNormalizedBackgrounds,
              objectDownloaded: props.objectDownloaded,
              validObjectIds: Array.from(props.validObjectIds ?? []),
              selectedFields: props.selectedFields,
            }),
          ),
          [
            "consensus_genome",
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
              "data-testid": "set-field",
              onClick: () =>
                props.onSelectField(
                  "consensus_genome",
                  "download_format",
                  "Single File (Concatenated)",
                  "Single File",
                ),
            },
            "set field",
          ),
          ReactLib.createElement(
            "button",
            {
              "data-testid": "unset-field",
              onClick: () =>
                props.onSelectField("consensus_genome", "download_format"),
            },
            "unset field",
          ),
          ReactLib.createElement(
            "button",
            {
              "data-testid": "unset-missing-field",
              onClick: () => props.onSelectField("never_selected", "some_type"),
            },
            "unset missing field",
          ),
          ReactLib.createElement(
            "button",
            {
              "data-testid": "invalid-field",
              onClick: () => props.onSelectField(undefined, undefined, 1),
            },
            "invalid field",
          ),
          ReactLib.createElement(
            "button",
            {
              "data-testid": "set-biom-field",
              onClick: () => {
                props.onSelectField(
                  "biom_format",
                  "filter_by",
                  [{ metric: "nt_rpm", value: 1 }] as any,
                  "NT rPM",
                );
                props.onSelectField(
                  "biom_format",
                  "metric",
                  "NT rPM",
                  "NT rPM",
                );
              },
            },
            "set biom field",
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
              sampleHostGenomes: props.sampleHostGenomes,
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

const footerState = () =>
  JSON.parse(screen.getByTestId("footer-state").textContent as string);
const optionsState = () =>
  JSON.parse(screen.getByTestId("options-state").textContent as string);

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
  // The mount effect kicks off six parallel requests; wait for the loading
  // flag to clear before asserting on anything downstream of them.
  await waitFor(() => expect(footerState().loading).toBe(false));
  return { ...utils, props: merged };
};

beforeEach(() => {
  jest.clearAllMocks();
  cgOverviewObserver = null;

  mockGetBulkDownloadTypes.mockResolvedValue([
    {
      type: "consensus_genome",
      fields: [
        {
          type: "download_format",
          default_value: {
            value: "Separate Files",
            display_name: "Separate Files",
          },
        },
        { type: "no_default" },
      ],
    },
    { type: "sample_metadata" },
  ]);
  mockGetBulkDownloadMetrics.mockResolvedValue([
    { text: "NT rPM", value: "NT_rpm" },
  ]);
  mockGetBackgrounds.mockResolvedValue({
    backgrounds: [{ id: 1, name: "Background", mass_normalized: true }],
  });
  mockGetMassNormalizedBackgroundAvailability.mockResolvedValue({
    massNormalizedBackgroundsAvailable: true,
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

describe("BulkDownloadModal initial load", () => {
  it("fans out the option fetches and pushes the parsed validation into the footer", async () => {
    await renderModal();

    const footer = footerState();
    expect(footer.validObjectIds).toEqual(["1"]);
    expect(footer.invalidSampleNames).toEqual(["Sample Two"]);
    expect(footer.validationError).toBeNull();
    // Only the valid object contributes a host genome row.
    expect(footer.sampleHostGenomes).toEqual([
      { id: "1", name: "Sample One", hostGenome: "Human" },
    ]);

    const options = optionsState();
    expect(options.downloadTypeCount).toBe(2);
    expect(options.backgroundOptionCount).toBe(1);
    expect(options.metricsOptionCount).toBe(1);
    // Every consensus genome run is owned by user 42.
    expect(options.areAllObjectsUploadedByCurrentUser).toBe(true);
    // Workflow-run entities never run the collaborator check.
    expect(options.isUserCollaboratorOnAllRequestedSamples).toBe(false);
    expect(options.enableMassNormalizedBackgrounds).toBe(true);
    expect(options.objectDownloaded).toBe("consensus genome");
    // Default field values from the download types are pre-selected.
    expect(options.selectedFields).toEqual({
      consensus_genome: { download_format: "Separate Files" },
    });
  });

  it("renders a pluralized tagline for the selected objects", async () => {
    const { container } = await renderModal();
    expect(container.textContent).toContain("2 consensus genomes selected");
  });

  it("renders a singular tagline for one selected object", async () => {
    const { container } = await renderModal({ selectedIds: new Set(["1"]) });
    expect(container.textContent).toContain("1 consensus genome selected");
  });

  it("skips the mass-normalized background lookup when nothing is selected", async () => {
    await renderModal({ selectedIds: undefined });
    expect(mockGetMassNormalizedBackgroundAvailability).not.toHaveBeenCalled();
    expect(optionsState().enableMassNormalizedBackgrounds).toBeUndefined();
  });

  it("uses the Rails validation path for mNGS workflows", async () => {
    await renderModal({
      workflow: WorkflowType.SHORT_READ_MNGS,
      workflowEntity: WORKFLOW_ENTITIES.SAMPLES,
    });

    expect(mockValidateSampleIds).toHaveBeenCalledWith({
      sampleIds: ["1", "2"],
      workflow: WorkflowType.SHORT_READ_MNGS,
    });
    const footer = footerState();
    expect(footer.validObjectIds).toEqual(["1"]);
    expect(footer.invalidSampleNames).toEqual(["Sample Two"]);
    // The Rails owner parser just passes the API's answer through.
    expect(optionsState().areAllObjectsUploadedByCurrentUser).toBe(true);
    // Sample entities do run the collaborator check.
    expect(optionsState().isUserCollaboratorOnAllRequestedSamples).toBe(true);
  });
});

describe("BulkDownloadModal download type selection", () => {
  it("records the selected download type and ignores a repeat selection", async () => {
    await renderModal();
    expect(optionsState().selectedDownloadTypeName).toBeNull();

    act(() => {
      screen.getByTestId("select-consensus_genome").click();
    });
    expect(optionsState().selectedDownloadTypeName).toBe("consensus_genome");

    act(() => {
      screen.getByTestId("select-consensus_genome").click();
    });
    expect(optionsState().selectedDownloadTypeName).toBe("consensus_genome");
  });

  it("sets, unsets and ignores field selections", async () => {
    await renderModal();

    act(() => {
      screen.getByTestId("set-field").click();
    });
    expect(optionsState().selectedFields.consensus_genome).toEqual({
      download_format: "Single File (Concatenated)",
    });

    act(() => {
      screen.getByTestId("unset-field").click();
    });
    // The key survives with an undefined value, which JSON drops.
    expect(optionsState().selectedFields.consensus_genome).toEqual({});

    act(() => {
      screen.getByTestId("unset-missing-field").click();
    });
    expect(optionsState().selectedFields.never_selected).toBeUndefined();

    act(() => {
      screen.getByTestId("invalid-field").click();
    });
    expect(optionsState().selectedFields.consensus_genome).toEqual({});
  });
});

describe("BulkDownloadModal consensus genome mutation path", () => {
  const startDownload = async () => {
    const rendered = await renderModal();
    act(() => {
      screen.getByTestId("set-field").click();
      screen.getByTestId("select-consensus_genome").click();
    });
    act(() => {
      screen.getByTestId("download").click();
    });
    return rendered;
  };

  it("kicks off the Relay mutation with the selected format and calls onGenerate on success", async () => {
    const onGenerate = jest.fn();
    const rendered = await renderModal({ onGenerate });
    act(() => {
      screen.getByTestId("set-field").click();
      screen.getByTestId("select-consensus_genome").click();
    });
    act(() => {
      screen.getByTestId("download").click();
    });

    expect(footerState().waitingForCreate).toBe(true);
    const config = mockCommitMutation.mock.calls[0][0];
    expect(config.variables).toEqual({
      workflowRunIdsStrings: ["1", "2"],
      downloadFormat: "Single File (Concatenated)",
      downloadType: "consensus_genome",
      workflow: WorkflowType.CONSENSUS_GENOME,
      authenticityToken: "csrf-token",
    });

    act(() => {
      config.onCompleted({ createAsyncBulkDownload: { id: "abc" } });
    });
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(rendered.container).toBeTruthy();
  });

  it("surfaces the default error when the mutation returns no download id", async () => {
    await startDownload();
    const config = mockCommitMutation.mock.calls[0][0];

    act(() => {
      config.onCompleted({ createAsyncBulkDownload: null });
    });

    const footer = footerState();
    expect(footer.createStatus).toBe("error");
    expect(footer.createError).toBe(
      "An unknown error occurred. Please contact us for help.",
    );
    expect(footer.waitingForCreate).toBe(false);
  });

  it("surfaces the default error when the mutation errors", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await startDownload();
    const config = mockCommitMutation.mock.calls[0][0];

    act(() => {
      config.onError(new Error("network down"));
    });

    expect(footerState().createStatus).toBe("error");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("BulkDownloadModal consensus genome overview path", () => {
  const startOverviewDownload = async (props: Record<string, any> = {}) => {
    const rendered = await renderModal(props);
    act(() => {
      screen.getByTestId("select-consensus_genome_overview").click();
    });
    act(() => {
      screen.getByTestId("download").click();
    });
    return rendered;
  };

  it("downloads the returned CSV rows and closes the modal", async () => {
    const onClose = jest.fn();
    await startOverviewDownload({ onClose });

    expect(cgOverviewObserver).not.toBeNull();
    act(() => {
      cgOverviewObserver.next({
        BulkDownloadCGOverview: { cgOverviewRows: [["a", "b"]] },
      });
    });

    expect(mockDownloadFileFromCSV).toHaveBeenCalledWith(
      [["a", "b"]],
      "consensus_genome_overview",
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("errors when the overview query returns no rows", async () => {
    const onClose = jest.fn();
    await startOverviewDownload({ onClose });

    act(() => {
      cgOverviewObserver.next({ BulkDownloadCGOverview: null });
    });

    expect(mockDownloadFileFromCSV).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(footerState().createStatus).toBe("error");
  });

  it("surfaces the query error message", async () => {
    await startOverviewDownload();

    act(() => {
      cgOverviewObserver.error(new Error("overview blew up"));
    });

    expect(footerState().createError).toBe("overview blew up");
  });

  it("still closes the modal when writing the CSV throws", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onClose = jest.fn();
    mockDownloadFileFromCSV.mockImplementationOnce(() => {
      throw new Error("csv failed");
    });
    await startOverviewDownload({ onClose });

    act(() => {
      cgOverviewObserver.next({
        BulkDownloadCGOverview: { cgOverviewRows: [["a"]] },
      });
    });

    expect(consoleError).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

describe("BulkDownloadModal sample metadata path", () => {
  it("downloads the metadata CSV and closes the modal", async () => {
    mockCreateSampleMetadataBulkDownload.mockResolvedValue({
      sample_metadata: [["header"], ["row"]],
    });
    const onClose = jest.fn();
    await renderModal({ onClose });

    act(() => {
      screen.getByTestId("select-sample_metadata").click();
    });
    await act(async () => {
      screen.getByTestId("download").click();
    });

    // Consensus genome maps workflow run ids back to their Rails sample ids.
    expect(mockCreateSampleMetadataBulkDownload).toHaveBeenCalledWith(["s1"]);
    expect(mockDownloadFileFromCSV).toHaveBeenCalledWith(
      [["header"], ["row"]],
      "sample_metadata",
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports the API error when no metadata comes back", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockCreateSampleMetadataBulkDownload.mockResolvedValue({
      sample_metadata: null,
      error: "metadata unavailable",
    });
    const onClose = jest.fn();
    await renderModal({ onClose });

    act(() => {
      screen.getByTestId("select-sample_metadata").click();
    });
    await act(async () => {
      screen.getByTestId("download").click();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(footerState().createError).toBe("metadata unavailable");
    consoleError.mockRestore();
  });
});

describe("BulkDownloadModal generic createBulkDownload path", () => {
  it("creates the download, tracks the event and calls onGenerate", async () => {
    mockCreateBulkDownload.mockResolvedValue({});
    const onGenerate = jest.fn();
    await renderModal({ onGenerate });

    act(() => {
      screen.getByTestId("select-reads_non_host").click();
    });
    await act(async () => {
      screen.getByTestId("download").click();
    });

    expect(mockCreateBulkDownload).toHaveBeenCalledTimes(1);
    const selectedDownload = mockCreateBulkDownload.mock.calls[0][0];
    expect(selectedDownload.downloadType).toBe("reads_non_host");
    expect(selectedDownload.validObjectIds).toEqual(["1", "2"]);
    expect(selectedDownload.workflow).toBe(WorkflowType.CONSENSUS_GENOME);

    expect(mockTrackEvent).toHaveBeenCalledWith(
      "bulk_download_creation_successful",
      {
        workflow: WorkflowType.CONSENSUS_GENOME,
        downloadType: "reads_non_host",
        workflowRunIds: ["1", "2"],
      },
    );
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("reports a creation failure without calling onGenerate", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockCreateBulkDownload.mockRejectedValue({ error: "quota exceeded" });
    const onGenerate = jest.fn();
    await renderModal({ onGenerate });

    act(() => {
      screen.getByTestId("select-reads_non_host").click();
    });
    await act(async () => {
      screen.getByTestId("download").click();
    });

    expect(onGenerate).not.toHaveBeenCalled();
    expect(footerState().createError).toBe("quota exceeded");
    expect(mockTrackEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("labels the ids as sampleIds for sample-entity workflows", async () => {
    mockCreateBulkDownload.mockResolvedValue({});
    await renderModal({
      workflow: WorkflowType.SHORT_READ_MNGS,
      workflowEntity: WORKFLOW_ENTITIES.SAMPLES,
    });

    act(() => {
      screen.getByTestId("select-reads_non_host").click();
    });
    await act(async () => {
      screen.getByTestId("download").click();
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      "bulk_download_creation_successful",
      expect.objectContaining({ sampleIds: ["1", "2"] }),
    );
  });
});

describe("BulkDownloadModal heatmap link", () => {
  it("opens the heatmap without presets when no biom fields are selected", async () => {
    await renderModal();
    act(() => {
      screen.getByTestId("heatmap-link").click();
    });

    expect(mockOpenUrlInNewTab).toHaveBeenCalledTimes(1);
    const url = mockOpenUrlInNewTab.mock.calls[0][0] as string;
    expect(url.startsWith("/visualizations/heatmap?")).toBe(true);
    // No filter_by / metric selection means neither preset is pushed, and the
    // empty preset + null threshold params are dropped by getURLParamString.
    expect(url).not.toContain("presets");
    expect(url).not.toContain("thresholdFilters");
    expect(url).toContain("metric=false");
    // Falls back to the default background model.
    expect(url).toContain("background=");
  });

  it("adds the threshold and metric presets once biom fields are selected", async () => {
    await renderModal();
    act(() => {
      screen.getByTestId("set-biom-field").click();
    });
    act(() => {
      screen.getByTestId("heatmap-link").click();
    });

    const url = mockOpenUrlInNewTab.mock.calls[0][0] as string;
    expect(url).toContain("thresholdFilters");
    expect(url).toContain("metric");
    // The valid object id is carried into the heatmap sample list.
    expect(url).toContain("sampleIds");
  });
});

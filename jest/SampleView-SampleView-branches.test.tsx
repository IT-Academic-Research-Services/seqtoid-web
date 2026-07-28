// Branch coverage for app/assets/src/components/views/SampleView/SampleView.tsx
//
// The existing SampleView suite walks the main report flow. What it leaves
// unvisited are the decision points that only fire on the awkward inputs:
// selecting a pipeline version that has no matching run, deleting the last run
// on a sample, the persisted-background save conflicts, the incompatible /
// mass-normalized background guards, clearAllFilters on the long-read tab and
// the getCurrentRun resolution ladder.
//
// The harness matches the existing suite: Relay is mocked wholesale and every
// presentational child is a prop-capturing double, so the callbacks SampleView
// hands down can be invoked directly.
import { act, render, waitFor } from "@testing-library/react";
import { getBackgrounds, getSampleReportData, getSamples } from "~/api";
import { getAmrDeprecatedData } from "~/api/amr";
import {
  createPersistedBackground,
  getPersistedBackground,
  updatePersistedBackground,
} from "~/api/persisted_backgrounds";
import { WORKFLOW_TABS, WorkflowType } from "~/components/utils/workflows";
import { SampleView } from "~/components/views/SampleView/SampleView";
import { GlobalContext } from "~/globalContext/reducer";

jest.mock("~/components/common/SampleMessage/sample_message.scss", () => ({}), {
  virtual: true,
});

let mockSampleData: $TSFixMe = null;
let mockSubscribeHandlers: $TSFixMe = null;

jest.mock("react-relay", () => ({
  __esModule: true,
  useLazyLoadQuery: () => mockSampleData,
  useRelayEnvironment: () => ({ name: "test-env" }),
}));

jest.mock("relay-runtime", () => ({
  __esModule: true,
  graphql: () => ({ kind: "Request" }),
  fetchQuery: jest.fn(() => ({
    subscribe: (handlers: $TSFixMe) => {
      mockSubscribeHandlers = handlers;
    },
  })),
}));

jest.mock("~/api", () => ({
  __esModule: true,
  getBackgrounds: jest.fn(),
  getCoverageVizSummary: jest.fn(),
  getSampleReportData: jest.fn(),
  getSamples: jest.fn(),
}));
jest.mock("~/api/amr", () => ({
  __esModule: true,
  getAmrDeprecatedData: jest.fn(),
}));
jest.mock("~/api/persisted_backgrounds", () => ({
  __esModule: true,
  createPersistedBackground: jest.fn(),
  getPersistedBackground: jest.fn(),
  updatePersistedBackground: jest.fn(),
}));

const mockTrackEvent = jest.fn();
jest.mock("~/api/analytics", () => ({
  __esModule: true,
  useTrackEvent: () => mockTrackEvent,
  ANALYTICS_EVENT_NAMES: {
    PIPELINE_SAMPLE_REPORT_SAMPLE_VIEWED: "sample_viewed",
    SAMPLE_VIEW_SINGLE_RUN_DELETED: "single_run_deleted",
  },
}));

const mockShowToast = jest.fn();
jest.mock("~/components/utils/toast", () => ({
  __esModule: true,
  showToast: (...args: $TSFixMe[]) => mockShowToast(...args),
}));
jest.mock("react-toastify", () => ({
  __esModule: true,
  toast: { dismiss: jest.fn() },
}));

jest.mock("~/components/utils/csv", () => ({
  __esModule: true,
  computeMngsReportTableValuesForCSV: jest.fn(() => [
    ["header"],
    [["row-value"]],
  ]),
  createCSVObjectURL: jest.fn(() => "blob:csv-url"),
}));

const childProps: Record<string, $TSFixMe> = {};

const captureStub = (key: string, testId: string) => (props: $TSFixMe) => {
  childProps[key] = props;
  return <div data-testid={testId} />;
};

jest.mock("~/components/views/SampleView/components/SampleViewHeader", () => ({
  __esModule: true,
  SampleViewHeader: (props: $TSFixMe) => {
    childProps.header = props;
    return <div data-testid="sample-view-header" />;
  },
}));
jest.mock("~/components/views/SampleView/components/TabSwitcher", () => ({
  __esModule: true,
  TabSwitcher: (props: $TSFixMe) => {
    childProps.tabs = props;
    return <div data-testid="tab-switcher" />;
  },
}));
jest.mock("~/components/views/SampleView/components/ReportPanel", () => ({
  __esModule: true,
  ReportPanel: (props: $TSFixMe) => {
    childProps.report = props;
    return <div data-testid="report-panel" />;
  },
}));
jest.mock(
  "~/components/views/SampleView/components/DetailsSidebarSwitcher",
  () => ({
    __esModule: true,
    DetailsSidebarSwitcher: (props: $TSFixMe) => {
      childProps.sidebar = props;
      return <div data-testid="details-sidebar" />;
    },
  }),
);
jest.mock("~/components/views/SampleView/components/ModalManager", () => ({
  __esModule: true,
  ModalManager: (props: $TSFixMe) => {
    childProps.modals = props;
    return <div data-testid="modal-manager" />;
  },
}));
jest.mock("~/components/common/CoverageVizBottomSidebar", () => ({
  __esModule: true,
  default: captureStub("coverageViz", "coverage-viz"),
}));
jest.mock("~/components/common/CoverageVizBottomSidebar/utils", () => ({
  __esModule: true,
  getCoverageVizParams: jest.fn(() => ({ stubbed: true })),
}));
jest.mock("~/components/layout/NarrowContainer", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <div>{props.children}</div>,
}));
jest.mock("~/components/common/ErrorBoundary", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <div>{props.children}</div>,
}));
jest.mock("~/components/ui/icons", () => ({
  __esModule: true,
  IconLoading: () => <span data-testid="icon-loading" />,
}));
jest.mock("~/components/common/SampleMessage", () => ({
  __esModule: true,
  SampleMessage: (props: $TSFixMe) => (
    <div data-testid="sample-message">{props.message}</div>
  ),
}));

const mockedGetBackgrounds = getBackgrounds as unknown as jest.Mock;
const mockedGetSampleReportData = getSampleReportData as unknown as jest.Mock;
const mockedGetSamples = getSamples as unknown as jest.Mock;
const mockedGetAmrDeprecatedData = getAmrDeprecatedData as unknown as jest.Mock;
const mockedGetPersistedBackground =
  getPersistedBackground as unknown as jest.Mock;
const mockedCreatePersistedBackground =
  createPersistedBackground as unknown as jest.Mock;
const mockedUpdatePersistedBackground =
  updatePersistedBackground as unknown as jest.Mock;

const PIPELINE_RUN = {
  id: 11,
  pipeline_version: "8.0",
  alignment_config_name: "2021-01-22",
  wdl_version: "8.0",
  assembled: 1,
  run_finalized: true,
  created_at: "2024-01-01",
};

const CG_RUN = {
  id: 21,
  workflow: WorkflowType.CONSENSUS_GENOME,
  wdl_version: "3.4.1",
  status: "SUCCEEDED",
  deprecated: false,
  inputs: { accession_id: "MN908947.3", taxon_id: 2697049 },
};

const buildSample = (overrides: $TSFixMe = {}) => ({
  id: "1",
  railsSampleId: 1,
  name: "Sample A",
  default_pipeline_run_id: 11,
  initial_workflow: WorkflowType.SHORT_READ_MNGS,
  project: { id: "7", name: "Project Seven" },
  project_id: 7,
  status: "created",
  pipeline_runs: [PIPELINE_RUN],
  workflow_runs: [CG_RUN],
  ...overrides,
});

const globalContextValue = {
  globalContextState: {} as $TSFixMe,
  globalContextDispatch: jest.fn(),
};

const renderSampleView = async (sample: $TSFixMe = buildSample()) => {
  mockSampleData = sample === null ? null : { SampleForReport: sample };
  const utils = render(
    <GlobalContext.Provider value={globalContextValue as $TSFixMe}>
      <SampleView sampleId={1} />
    </GlobalContext.Provider>,
  );
  await waitFor(() => expect(childProps.report).toBeTruthy());
  return utils;
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(childProps).forEach(key => delete childProps[key]);
  mockSubscribeHandlers = null;
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  mockedGetBackgrounds.mockResolvedValue({
    owned_backgrounds: [{ id: 5, name: "Owned BG", mass_normalized: false }],
    other_backgrounds: [{ id: 6, name: "Other BG", mass_normalized: true }],
  });
  mockedGetSampleReportData.mockResolvedValue({
    counts: {
      1: { 301: { name: "Species A", nt: { count: 5 } } },
      2: { 300: { name: "Genus A", species_tax_ids: [301] } },
    },
    sortedGenus: [300],
    highlightedTaxIds: [301],
    metadata: { backgroundId: 5, pipelineRunStatus: "SUCCEEDED" },
    lineage: {},
    all_tax_ids: [300, 301],
  });
  mockedGetSamples.mockResolvedValue({
    samples: [{ id: 1, name: "Sample A" }],
  });
  mockedGetAmrDeprecatedData.mockResolvedValue([]);
  mockedGetPersistedBackground.mockRejectedValue({
    error: "Persisted background not found",
  });
  mockedCreatePersistedBackground.mockResolvedValue({});
  mockedUpdatePersistedBackground.mockResolvedValue({});
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SampleView -- pipeline version selection guards", () => {
  it("does nothing when the selected version is already the current one", async () => {
    await renderSampleView();
    const before = childProps.header.currentRun;

    act(() => {
      childProps.header.onPipelineVersionChange(
        childProps.header.pipelineVersion,
      );
    });
    await waitFor(() => expect(childProps.header.currentRun).toBe(before));
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs and bails when no pipeline run matches the requested version", async () => {
    await renderSampleView();

    act(() => {
      childProps.header.onPipelineVersionChange("99.9");
    });

    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "No run found for the selected pipeline version",
      ),
    );
    // The current run is untouched by the failed switch.
    expect(childProps.header.currentRun.id).toBe(11);
  });

  it("switches to another pipeline run when one matches", async () => {
    const secondRun = {
      ...PIPELINE_RUN,
      id: 12,
      pipeline_version: "7.1",
      wdl_version: "7.1",
    };
    await renderSampleView(
      buildSample({ pipeline_runs: [PIPELINE_RUN, secondRun] }),
    );

    act(() => {
      childProps.header.onPipelineVersionChange("7.1");
    });

    await waitFor(() => expect(childProps.header.currentRun.id).toBe(12));
    expect(console.error).not.toHaveBeenCalled();
  });

  it("logs and bails when no workflow run matches on a workflow-run tab", async () => {
    window.history.replaceState(
      {},
      "",
      `/?currentTab=${encodeURIComponent(WORKFLOW_TABS.CONSENSUS_GENOME)}`,
    );
    await renderSampleView();
    await waitFor(() =>
      expect(childProps.header.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME),
    );

    act(() => {
      childProps.header.onPipelineVersionChange("0.0.1");
    });

    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "No run found for the selected pipeline version",
      ),
    );
  });

  it("switches to another workflow run when one matches", async () => {
    const secondCg = { ...CG_RUN, id: 22, wdl_version: "3.5.0" };
    window.history.replaceState(
      {},
      "",
      `/?currentTab=${encodeURIComponent(WORKFLOW_TABS.CONSENSUS_GENOME)}`,
    );
    await renderSampleView(buildSample({ workflow_runs: [CG_RUN, secondCg] }));
    await waitFor(() =>
      expect(childProps.header.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME),
    );

    act(() => {
      childProps.header.onPipelineVersionChange("3.5.0");
    });

    await waitFor(() => expect(childProps.header.currentRun.id).toBe(22));
  });
});

describe("SampleView -- deleting the current run", () => {
  it("navigates back to the project when the last run is deleted", async () => {
    const replace = jest.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, replace },
    });

    try {
      // A single short-read run and no workflow runs -> total count is 1.
      await renderSampleView(buildSample({ workflow_runs: [] }));

      act(() => {
        childProps.header.onDeleteRunSuccess(childProps.header.sample);
      });

      await waitFor(() => expect(replace).toHaveBeenCalled());
      expect(replace.mock.calls[0][0]).toBe("/home?project_id=7");
      // The delete flag is left in the discovery session state for the
      // project page to pick up.
      expect(String(sessionStorage.getItem("DiscoveryViewOptions"))).toContain(
        "Sample A",
      );
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("stays on the page and moves to the remaining tab when other runs exist", async () => {
    const replace = jest.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, replace },
    });

    try {
      // Two short-read runs plus a CG run -> more than one workflow remains.
      await renderSampleView(
        buildSample({
          pipeline_runs: [PIPELINE_RUN, { ...PIPELINE_RUN, id: 12 }],
        }),
      );

      act(() => {
        childProps.header.onDeleteRunSuccess(childProps.header.sample);
      });

      await waitFor(() => expect(mockTrackEvent).toHaveBeenCalled());
      // No navigation away from the sample.
      expect(replace).not.toHaveBeenCalled();
      const event = mockTrackEvent.mock.calls.find(
        call => call[0] === "single_run_deleted",
      );
      expect(event).toBeTruthy();
      expect(event[1].projectId).toBe("7");
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("reports the workflow-run status rather than the pipeline status on a CG tab", async () => {
    window.history.replaceState(
      {},
      "",
      `/?currentTab=${encodeURIComponent(WORKFLOW_TABS.CONSENSUS_GENOME)}`,
    );
    await renderSampleView(
      buildSample({
        pipeline_runs: [PIPELINE_RUN, { ...PIPELINE_RUN, id: 12 }],
      }),
    );
    await waitFor(() =>
      expect(childProps.header.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME),
    );

    act(() => {
      childProps.header.onDeleteRunSuccess(childProps.header.sample);
    });

    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalled());
    const event = mockTrackEvent.mock.calls.find(
      call => call[0] === "single_run_deleted",
    );
    // CG_RUN.status is SUCCEEDED, lowercased by the tracker.
    expect(event[1].runStatus).toBe("succeeded");
    expect(event[1].workflow).toBe(WorkflowType.CONSENSUS_GENOME);
  });
});

describe("SampleView -- background compatibility guards", () => {
  it("clears a mass-normalized background the sample cannot use", async () => {
    // Background 6 is mass_normalized; the sample has no ERCC counts, so
    // mass-normalized backgrounds are disabled and the selection is dropped.
    window.history.replaceState({}, "", "/?background=6");
    await renderSampleView();

    await waitFor(() => expect(mockedGetSampleReportData).toHaveBeenCalled());
    const lastCall =
      mockedGetSampleReportData.mock.calls[
        mockedGetSampleReportData.mock.calls.length - 1
      ][0];
    // The incompatible background is not sent to the report endpoint.
    expect(lastCall.background).not.toBe(6);
  });

  it("passes an explicit backgroundId straight through to the report fetch", async () => {
    await renderSampleView();
    mockedGetSampleReportData.mockClear();

    // handleAnnotationUpdate is fetchSampleReportData; calling it with an
    // explicit id takes the `backgroundId || ...` short-circuit.
    await act(async () => {
      await childProps.report.handleAnnotationUpdate({ backgroundId: 5 });
    });

    await waitFor(() => expect(mockedGetSampleReportData).toHaveBeenCalled());
    const lastCall =
      mockedGetSampleReportData.mock.calls[
        mockedGetSampleReportData.mock.calls.length - 1
      ][0];
    expect(lastCall.background).toBe(5);
  });

  it("falls back to no background when the sample has none selected", async () => {
    mockedGetBackgrounds.mockResolvedValue({
      owned_backgrounds: [],
      other_backgrounds: [],
    });
    await renderSampleView();
    mockedGetSampleReportData.mockClear();

    await act(async () => {
      await childProps.report.handleAnnotationUpdate({});
    });

    await waitFor(() => expect(mockedGetSampleReportData).toHaveBeenCalled());
    const lastCall =
      mockedGetSampleReportData.mock.calls[
        mockedGetSampleReportData.mock.calls.length - 1
      ][0];
    expect(lastCall.background).toBeNull();
  });
});

describe("SampleView -- persisted background save conflicts", () => {
  // The background is persisted from an effect as soon as a report fetch
  // succeeds for a project that has no persisted background yet, so simply
  // rendering drives the create path.
  it("re-syncs the flag when the create has not committed yet", async () => {
    mockedCreatePersistedBackground.mockRejectedValue({
      error: "Persisted background not found",
    });

    await renderSampleView();

    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(String((console.warn as jest.Mock).mock.calls[0][0])).toMatch(
      /create not yet committed/,
    );
    // This known race is not escalated to Sentry.
    expect(console.error).not.toHaveBeenCalled();
  });

  it("re-syncs the flag when a background is already persisted", async () => {
    mockedCreatePersistedBackground.mockRejectedValue({
      error: "already has a background persisted",
    });

    await renderSampleView();

    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(String((console.warn as jest.Mock).mock.calls[0][0])).toMatch(
      /already exists/,
    );
  });

  it("logs the persisted-background lookup error only when it is unexpected", async () => {
    mockedGetPersistedBackground.mockRejectedValue({ error: "boom" });
    await renderSampleView();

    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith({ error: "boom" }),
    );
  });
});

describe("SampleView -- clearAllFilters per tab", () => {
  it("clears the short-read thresholds on the short-read tab", async () => {
    await renderSampleView();
    expect(childProps.report.currentTab).toBe(WORKFLOW_TABS.SHORT_READ_MNGS);

    await act(async () => {
      childProps.report.clearAllFilters();
    });

    await waitFor(() =>
      expect(childProps.report.selectedOptions.thresholdsShortReads).toEqual(
        [],
      ),
    );
    expect(childProps.report.selectedOptions.taxa).toEqual([]);
    expect(childProps.report.selectedOptions.categories).toEqual({});
  });

  it("clears the long-read thresholds on the long-read tab", async () => {
    window.history.replaceState(
      {},
      "",
      `/?currentTab=${encodeURIComponent(WORKFLOW_TABS.LONG_READ_MNGS)}`,
    );
    await renderSampleView(
      buildSample({ initial_workflow: WorkflowType.LONG_READ_MNGS }),
    );
    await waitFor(() =>
      expect(childProps.report.currentTab).toBe(WORKFLOW_TABS.LONG_READ_MNGS),
    );

    await act(async () => {
      childProps.report.clearAllFilters();
    });

    await waitFor(() =>
      expect(childProps.report.selectedOptions.thresholdsLongReads).toEqual([]),
    );
    expect(childProps.report.selectedOptions.annotations).toEqual([]);
  });
});

describe("SampleView -- degenerate report payloads", () => {
  it("renders an empty report when the response has no counts or sortedGenus", async () => {
    mockedGetSampleReportData.mockResolvedValue({
      metadata: { pipelineRunStatus: "SUCCEEDED" },
    });
    await renderSampleView();

    await waitFor(() => expect(childProps.report.reportData).toEqual([]));
    expect(childProps.report.filteredReportData).toEqual([]);
  });

  it("skips a genus the counts map does not describe", async () => {
    mockedGetSampleReportData.mockResolvedValue({
      counts: { 1: {}, 2: {} },
      // 300 is sorted but absent from the genus counts.
      sortedGenus: [300],
      highlightedTaxIds: [],
      metadata: { pipelineRunStatus: "SUCCEEDED" },
      lineage: {},
      all_tax_ids: [],
    });
    await renderSampleView();

    await waitFor(() => expect(childProps.report.reportData).toEqual([]));
  });

  it("tolerates a genus whose species list is missing", async () => {
    mockedGetSampleReportData.mockResolvedValue({
      counts: {
        1: {},
        2: { 300: { name: "Genus A" } },
      },
      sortedGenus: [300],
      highlightedTaxIds: [],
      metadata: { pipelineRunStatus: "SUCCEEDED" },
      lineage: {},
      all_tax_ids: [300],
    });
    await renderSampleView();

    await waitFor(() => expect(childProps.report.reportData).toHaveLength(1));
    expect(childProps.report.reportData[0].species).toEqual([]);
  });
});

describe("SampleView -- getCurrentRun resolution", () => {
  it("matches a workflow run by wdl version when no run id is set", async () => {
    const secondCg = { ...CG_RUN, id: 22, wdl_version: "3.5.0" };
    window.history.replaceState(
      {},
      "",
      `/?currentTab=${encodeURIComponent(
        WORKFLOW_TABS.CONSENSUS_GENOME,
      )}&pipelineVersion=3.5.0`,
    );
    await renderSampleView(buildSample({ workflow_runs: [CG_RUN, secondCg] }));

    await waitFor(() =>
      expect(childProps.header.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME),
    );
    expect(childProps.header.currentRun).toBeTruthy();
  });

  it("falls back to the mNGS tab and its pipeline run when there are no workflow runs", async () => {
    window.history.replaceState(
      {},
      "",
      `/?currentTab=${encodeURIComponent(WORKFLOW_TABS.CONSENSUS_GENOME)}`,
    );
    await renderSampleView(buildSample({ workflow_runs: [] }));

    await waitFor(() =>
      expect(childProps.header.currentTab).toBe(WORKFLOW_TABS.SHORT_READ_MNGS),
    );
    // A pipeline-run tab resolves the current run from pipeline_runs.
    expect(childProps.header.currentRun.id).toBe(11);
  });
});

describe("SampleView -- header background id", () => {
  it("passes null to the header when the selected background is not a number", async () => {
    window.history.replaceState({}, "", "/?background=not-a-number");
    await renderSampleView();
    await waitFor(() => expect(childProps.header).toBeTruthy());
    expect(childProps.header.backgroundId).toBeNull();
  });
});

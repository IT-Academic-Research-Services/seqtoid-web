// Frontend BRANCH coverage: app/assets/src/components/views/SampleView/SampleView.tsx
//
// The companion suite (SampleView-SampleView.test.tsx) walks the happy paths.
// This one exists purely to drive the *other* side of SampleView's conditionals:
// the degenerate report payloads, the incompatible-background and stale-NCBI-index
// warnings, the persisted-background create-vs-update fork and each of its three
// rejection shapes, pipeline-version selection on the workflow-run tabs, every
// exit of handleDeleteCurrentRun, and the getCurrentRun fallbacks.
//
// Same shape of harness as the companion suite: Relay is stubbed, the API module
// is mocked, and all five presentational children are replaced with prop-capturing
// doubles so the callbacks SampleView hands down can be invoked directly.
import { act, render, waitFor } from "@testing-library/react";
import {
  getBackgrounds,
  getCoverageVizSummary,
  getSampleReportData,
  getSamples,
} from "~/api";
import { getAmrDeprecatedData } from "~/api/amr";
import {
  createPersistedBackground,
  getPersistedBackground,
  updatePersistedBackground,
} from "~/api/persisted_backgrounds";
import { logError } from "~/components/utils/logUtil";
import { WORKFLOW_TABS, WorkflowType } from "~/components/utils/workflows";
import { SampleView } from "~/components/views/SampleView/SampleView";
import { GlobalContext } from "~/globalContext/reducer";

jest.mock("~/components/common/SampleMessage/sample_message.scss", () => ({}), {
  virtual: true,
});

// ---------------------------------------------------------------- Relay ----
let mockSampleData: $TSFixMe = null;

jest.mock("react-relay", () => ({
  __esModule: true,
  useLazyLoadQuery: () => mockSampleData,
  useRelayEnvironment: () => ({ name: "test-env" }),
}));

jest.mock("relay-runtime", () => ({
  __esModule: true,
  graphql: () => ({ kind: "Request" }),
  fetchQuery: jest.fn(() => ({ subscribe: () => undefined })),
}));

// ------------------------------------------------------------------ API ----
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

jest.mock("~/components/utils/logUtil", () => ({
  __esModule: true,
  logError: jest.fn(),
}));

jest.mock("~/components/utils/csv", () => ({
  __esModule: true,
  computeMngsReportTableValuesForCSV: jest.fn(() => [["h"], [["v"]]]),
  createCSVObjectURL: jest.fn(() => "blob:csv-url"),
}));

// -------------------------------------------------------------- children ---
const childProps: Record<string, $TSFixMe> = {};

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
  default: (props: $TSFixMe) => {
    childProps.coverageViz = props;
    return <div data-testid="coverage-viz" />;
  },
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

// ----------------------------------------------------------------- setup ---
const mockedGetBackgrounds = getBackgrounds as unknown as jest.Mock;
const mockedGetSampleReportData = getSampleReportData as unknown as jest.Mock;
const mockedGetSamples = getSamples as unknown as jest.Mock;
const mockedGetCoverageVizSummary =
  getCoverageVizSummary as unknown as jest.Mock;
const mockedGetAmrDeprecatedData = getAmrDeprecatedData as unknown as jest.Mock;
const mockedGetPersistedBackground =
  getPersistedBackground as unknown as jest.Mock;
const mockedCreatePersistedBackground =
  createPersistedBackground as unknown as jest.Mock;
const mockedUpdatePersistedBackground =
  updatePersistedBackground as unknown as jest.Mock;
const mockedLogError = logError as unknown as jest.Mock;

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

const CG_RUN_NEWER = {
  id: 22,
  workflow: WorkflowType.CONSENSUS_GENOME,
  wdl_version: "4.0.0",
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

const renderSampleView = async (
  sample: $TSFixMe = buildSample(),
  search = "",
) => {
  window.history.replaceState({}, "", `/${search}`);
  mockSampleData = sample === null ? null : { SampleForReport: sample };
  const utils = render(
    <GlobalContext.Provider value={globalContextValue as $TSFixMe}>
      <SampleView sampleId={1} />
    </GlobalContext.Provider>,
  );
  await waitFor(() => expect(childProps.report).toBeTruthy());
  return utils;
};

// showNotification hands showToast a render prop. Calling it returns the React
// element without mounting it, so the copy can be read straight off the tree --
// that is what tells the two different warnings apart.
const collectText = (node: $TSFixMe): string => {
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (node.props) return collectText(node.props.children);
  return "";
};
const toastTexts = () =>
  mockShowToast.mock.calls.map(call =>
    collectText(call[0]({ closeToast: jest.fn() })),
  );

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(childProps).forEach(key => delete childProps[key]);
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  delete (window as $TSFixMe).analytics;
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
  mockedGetCoverageVizSummary.mockResolvedValue({});
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

describe("SampleView -- degenerate inputs", () => {
  it("renders an empty shell when the Relay query resolves without a sample", async () => {
    await renderSampleView(null);

    expect(childProps.header.sample).toBeNull();
    expect(childProps.report.reportData).toEqual([]);
    // Neither the report nor the project-sample list is requested without a sample.
    expect(mockedGetSampleReportData).not.toHaveBeenCalled();
    expect(mockedGetSamples).not.toHaveBeenCalled();
    // The sidebar/modal pair is gated on `sample && currentRun`.
    expect(childProps.sidebar).toBeUndefined();
  });

  it("pings Appcues when the analytics shim is on the window", async () => {
    const page = jest.fn();
    (window as $TSFixMe).analytics = { page };

    await renderSampleView();

    expect(page).toHaveBeenCalledTimes(1);
  });

  it("skips a genus the counts map does not describe", async () => {
    mockedGetSampleReportData.mockResolvedValue({
      counts: { 1: {}, 2: { 300: { name: "Genus A", species_tax_ids: [] } } },
      // 999 has no entry under counts[2] -- it must be dropped, not thrown on.
      sortedGenus: [300, 999],
      highlightedTaxIds: [],
      metadata: { backgroundId: 5 },
      all_tax_ids: [300],
    });

    await renderSampleView();

    await waitFor(() => expect(childProps.report.loadingReport).toBe(false));
    expect(childProps.report.reportData).toHaveLength(1);
    expect(childProps.report.reportData[0].taxId).toBe(300);
  });

  it("treats a genus with no species_tax_ids as childless", async () => {
    mockedGetSampleReportData.mockResolvedValue({
      counts: { 1: {}, 2: { 300: { name: "Genus A" } } },
      sortedGenus: [300],
      highlightedTaxIds: [],
      metadata: { backgroundId: 5 },
      all_tax_ids: [300],
    });

    await renderSampleView();

    await waitFor(() => expect(childProps.report.reportData).toHaveLength(1));
    expect(childProps.report.reportData[0].species).toEqual([]);
    expect(childProps.report.reportData[0].highlightedChildren).toBe(false);
  });

  it("defaults the report metadata when the response omits it", async () => {
    mockedGetSampleReportData.mockResolvedValue({
      sortedGenus: [],
      counts: {},
    });

    await renderSampleView();

    await waitFor(() => expect(childProps.report.loadingReport).toBe(false));
    // metadata.backgroundId is what seeds the background after a fetch; with no
    // metadata at all the whole object must default to {} rather than throwing.
    expect(childProps.report.reportMetadata).toEqual({});
    expect(childProps.report.selectedOptions.background).toBeNull();
    expect(childProps.report.reportData).toEqual([]);
  });

  it("flags an invalid background when the report request resolves null", async () => {
    mockedGetSampleReportData.mockResolvedValue(null);

    await renderSampleView();

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    expect(toastTexts().join(" ")).toContain(
      "is not compatible with this sample",
    );
    expect(childProps.report.selectedOptions.background).toBeNull();
  });
});

describe("SampleView -- background compatibility warnings", () => {
  // tempSelectedOptions (arriving from the heatmap) both seeds the background and
  // flips ignoreProjectBackground on, which is the only way to reach the
  // mass-normalized half of the compatibility check.
  // The background list arrives asynchronously, so the first report fetch runs
  // before it lands. Re-selecting the background once the list is in place is
  // what drives the compatibility check against a real background record.
  const withCarriedOverBackground = async (initialBackground: number) => {
    await renderSampleView(
      buildSample(),
      `?tempSelectedOptions=${encodeURIComponent(
        JSON.stringify({ background: initialBackground }),
      )}`,
    );
    await waitFor(() =>
      expect(childProps.report.backgrounds.length).toBeGreaterThan(0),
    );
    mockShowToast.mockClear();
  };

  const selectBackground = (id: number) =>
    act(() =>
      childProps.report.dispatchSelectedOptions({
        type: "optionChanged",
        payload: { key: "background", value: id },
      }),
    );

  it("warns when the carried-over background is mass normalized", async () => {
    await withCarriedOverBackground(5);

    selectBackground(6);

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    expect(toastTexts().join(" ")).toContain("Other BG");
    // Incompatible -> the background is dropped, so no persisted-background save.
    expect(mockedUpdatePersistedBackground).not.toHaveBeenCalled();
    expect(mockedCreatePersistedBackground).not.toHaveBeenCalled();
  });

  it("warns when the background was built on a different NCBI index", async () => {
    mockedGetBackgrounds.mockResolvedValue({
      owned_backgrounds: [
        {
          id: 5,
          name: "Owned BG",
          mass_normalized: false,
          // The sample's pipeline run is on 2021-01-22; 2019-05-01 is the stale one.
          alignment_config_names: ["2021-01-22", "2019-05-01"],
        },
      ],
      other_backgrounds: [],
    });

    await withCarriedOverBackground(9);

    selectBackground(5);

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    const text = toastTexts().join(" ");
    expect(text).toContain("different version of our NCBI index");
    expect(text).toContain("2021-01-22");
  });

  it("re-fetches the report with no explicit background on an annotation update", async () => {
    await renderSampleView();
    await waitFor(() => expect(mockedGetSampleReportData).toHaveBeenCalled());
    mockedGetSampleReportData.mockClear();

    // handleAnnotationUpdate calls fetchSampleReportData() with no argument at
    // all, exercising its default parameter.
    await act(async () => {
      await childProps.report.handleAnnotationUpdate();
    });

    expect(mockedGetSampleReportData).toHaveBeenCalledTimes(1);
    expect(mockedGetSampleReportData.mock.calls[0][0].sampleId).toBe(1);
  });
});

describe("SampleView -- persisted background", () => {
  const withExistingPersistedBackground = () =>
    mockedGetPersistedBackground.mockResolvedValue({ background_id: 5 });

  it("updates rather than creates when the project already has one", async () => {
    withExistingPersistedBackground();

    await renderSampleView();

    await waitFor(() =>
      expect(mockedUpdatePersistedBackground).toHaveBeenCalled(),
    );
    expect(mockedUpdatePersistedBackground).toHaveBeenCalledWith({
      projectId: 7,
      backgroundId: 5,
    });
    expect(mockedCreatePersistedBackground).not.toHaveBeenCalled();
  });

  it("logs an unexpected failure to read the persisted background", async () => {
    mockedGetPersistedBackground.mockRejectedValue({ error: "boom" });

    await renderSampleView();

    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith({ error: "boom" }),
    );
  });

  it("downgrades a not-yet-committed save to a warning", async () => {
    withExistingPersistedBackground();
    mockedUpdatePersistedBackground.mockRejectedValue({
      error: "Persisted background not found",
    });

    await renderSampleView();

    await waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        "Persisted background save skipped (create not yet committed)",
        expect.anything(),
      ),
    );
    expect(mockedLogError).not.toHaveBeenCalled();
  });

  it("downgrades an already-persisted collision to a warning", async () => {
    withExistingPersistedBackground();
    // No `error` key at all -- the guard has to fall back to the whole payload.
    mockedUpdatePersistedBackground.mockRejectedValue({
      message: "already has a background persisted",
    });

    await renderSampleView();

    await waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith(
        "Persisted background already exists; will update on next change",
        expect.anything(),
      ),
    );
    expect(mockedLogError).not.toHaveBeenCalled();
  });

  it("still reports a genuinely failed save", async () => {
    withExistingPersistedBackground();
    mockedUpdatePersistedBackground.mockRejectedValue({ error: "kaboom" });

    await renderSampleView();

    await waitFor(() => expect(mockedLogError).toHaveBeenCalled());
    expect(mockedLogError.mock.calls[0][0].message).toBe(
      "SampleView: Failed to persist background model selection",
    );
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("SampleView -- pipeline version selection on workflow-run tabs", () => {
  const cgSample = () =>
    buildSample({
      initial_workflow: WorkflowType.CONSENSUS_GENOME,
      pipeline_runs: [],
      workflow_runs: [CG_RUN, CG_RUN_NEWER],
    });

  it("swaps the workflow run when a matching wdl version exists", async () => {
    await renderSampleView(cgSample());
    await waitFor(() =>
      expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME),
    );
    expect(childProps.header.currentRun.id).toBe(CG_RUN.id);

    act(() => childProps.header.onPipelineVersionChange("4.0.0"));

    await waitFor(() =>
      expect(childProps.header.currentRun.id).toBe(CG_RUN_NEWER.id),
    );
  });

  it("logs and keeps the run when no workflow run carries that wdl version", async () => {
    await renderSampleView(cgSample());
    await waitFor(() =>
      expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME),
    );

    act(() => childProps.header.onPipelineVersionChange("99.9.9"));

    expect(console.error).toHaveBeenCalledWith(
      "No run found for the selected pipeline version",
    );
    expect(childProps.header.currentRun.id).toBe(CG_RUN.id);
  });

  it("looks in the workflow runs for the AMR tab too", async () => {
    await renderSampleView(cgSample());
    await waitFor(() => expect(childProps.tabs).toBeTruthy());

    act(() => childProps.tabs.handleTabChange(WORKFLOW_TABS.AMR));
    await waitFor(() =>
      expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.AMR),
    );
    act(() => childProps.header.onPipelineVersionChange("4.0.0"));

    // The sample only has consensus-genome runs, so the AMR lookup finds nothing.
    expect(console.error).toHaveBeenCalledWith(
      "No run found for the selected pipeline version",
    );
  });

  it("does nothing on a tab that is neither mNGS nor a CG/AMR tab", async () => {
    await renderSampleView(cgSample());
    await waitFor(() => expect(childProps.tabs).toBeTruthy());

    act(() => childProps.tabs.handleTabChange(WORKFLOW_TABS.BENCHMARK));
    await waitFor(() =>
      expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.BENCHMARK),
    );
    (console.error as jest.Mock).mockClear();

    act(() => childProps.header.onPipelineVersionChange("4.0.0"));

    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("SampleView -- deleting the current run", () => {
  it("bounces to the project page when the deleted run was the last one", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.header).toBeTruthy());

    act(() =>
      childProps.header.onDeleteRunSuccess(
        buildSample({ workflow_runs: [], name: "Sample A" }),
      ),
    );

    // The flag the DiscoveryView reads back to toast "sample deleted".
    const stored = JSON.parse(
      sessionStorage.getItem("DiscoveryViewOptions") ?? "{}",
    );
    expect(JSON.stringify(stored)).toContain("Sample A");
    expect(mockTrackEvent).toHaveBeenCalledWith("single_run_deleted", {
      workflow: WorkflowType.SHORT_READ_MNGS,
      runStatus: "succeeded",
      projectId: "7",
    });
  });

  it("falls back to upload_failed when the report has no pipeline status", async () => {
    mockedGetSampleReportData.mockResolvedValue({
      counts: {},
      sortedGenus: [],
      highlightedTaxIds: [],
      metadata: { backgroundId: 5 },
      all_tax_ids: [],
    });
    await renderSampleView();
    await waitFor(() => expect(childProps.report.loadingReport).toBe(false));

    act(() =>
      childProps.header.onDeleteRunSuccess(buildSample({ workflow_runs: [] })),
    );

    expect(mockTrackEvent).toHaveBeenCalledWith("single_run_deleted", {
      workflow: WorkflowType.SHORT_READ_MNGS,
      runStatus: "upload_failed",
      projectId: "7",
    });
  });

  it("drops the deleted consensus-genome run and moves to the next tab", async () => {
    await renderSampleView(
      buildSample({
        initial_workflow: WorkflowType.CONSENSUS_GENOME,
        workflow_runs: [CG_RUN, CG_RUN_NEWER],
      }),
    );
    await waitFor(() =>
      expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME),
    );

    act(() =>
      childProps.header.onDeleteRunSuccess(
        buildSample({
          initial_workflow: WorkflowType.CONSENSUS_GENOME,
          workflow_runs: [CG_RUN, CG_RUN_NEWER],
        }),
      ),
    );

    // The currently selected CG run (21) is filtered out; 22 survives.
    await waitFor(() =>
      expect(childProps.header.sample.workflow_runs).toEqual([CG_RUN_NEWER]),
    );
    expect(mockTrackEvent).toHaveBeenCalledWith("single_run_deleted", {
      workflow: WorkflowType.CONSENSUS_GENOME,
      runStatus: "succeeded",
      projectId: "7",
    });
    // One CG run and one pipeline run remain, so the tab stays on CG.
    expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME);
  });

  it("uses a placeholder status and an empty run list on a tab with no runs", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.tabs).toBeTruthy());

    // The benchmark tab has no workflow run of its own, so workflowRun is null
    // and workflowCount[benchmark] is 0.
    act(() => childProps.tabs.handleTabChange(WORKFLOW_TABS.BENCHMARK));
    await waitFor(() =>
      expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.BENCHMARK),
    );

    act(() =>
      childProps.header.onDeleteRunSuccess(
        buildSample({ workflow_runs: [CG_RUN, CG_RUN_NEWER] }),
      ),
    );

    expect(mockTrackEvent).toHaveBeenCalledWith("single_run_deleted", {
      workflow: WorkflowType.BENCHMARK,
      runStatus: "no workflow run status",
      projectId: "7",
    });
    // Nothing is removed (the current run is a pipeline run, not a workflow run),
    // and the tab falls back to the short-read mNGS tab.
    await waitFor(() =>
      expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.SHORT_READ_MNGS),
    );
  });

  it("tolerates a sample whose run list for the tab is missing entirely", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.header).toBeTruthy());

    act(() =>
      childProps.header.onDeleteRunSuccess({
        ...buildSample({ workflow_runs: [CG_RUN, CG_RUN_NEWER] }),
        pipeline_runs: undefined,
      }),
    );

    await waitFor(() =>
      expect(childProps.header.sample.pipeline_runs).toEqual([]),
    );
  });

  it("produces an empty run list when there is no current run to remove", async () => {
    // No runs at all -> getCurrentRun() returns null.
    await renderSampleView(
      buildSample({ pipeline_runs: [], workflow_runs: [] }),
    );
    await waitFor(() => expect(childProps.header.currentRun).toBeNull());

    act(() =>
      childProps.header.onDeleteRunSuccess(
        buildSample({
          pipeline_runs: [PIPELINE_RUN],
          workflow_runs: [CG_RUN, CG_RUN_NEWER],
        }),
      ),
    );

    await waitFor(() =>
      expect(childProps.header.sample.pipeline_runs).toEqual([]),
    );
  });
});

describe("SampleView -- current run resolution", () => {
  it("uses the selected workflow run object when the selection has no id", async () => {
    await renderSampleView(
      buildSample({
        initial_workflow: WorkflowType.CONSENSUS_GENOME,
        pipeline_runs: [],
        workflow_runs: [CG_RUN, CG_RUN_NEWER],
      }),
    );
    await waitFor(() =>
      expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME),
    );

    const idless = {
      id: null,
      workflow: WorkflowType.CONSENSUS_GENOME,
      wdl_version: "5.0.0",
      status: "RUNNING",
    };
    act(() => childProps.report.handleWorkflowRunSelect(idless));

    await waitFor(() => expect(childProps.header.currentRun).toBe(idless));
  });

  it("matches the workflow run to the pipeline version in the URL", async () => {
    const NULL_WDL_RUN = {
      id: 24,
      workflow: WorkflowType.CONSENSUS_GENOME,
      wdl_version: null,
      status: "SUCCEEDED",
    };
    const AMR_RUN = {
      id: 30,
      workflow: WorkflowType.AMR,
      wdl_version: "1.0.0",
      status: "SUCCEEDED",
    };

    await renderSampleView(
      buildSample({
        initial_workflow: WorkflowType.CONSENSUS_GENOME,
        pipeline_runs: [],
        // null entry, wrong workflow, missing wdl_version and a real match: every
        // shape the version matcher has to survive.
        workflow_runs: [null, AMR_RUN, CG_RUN, NULL_WDL_RUN, CG_RUN_NEWER],
      }),
      "?pipelineVersion=4.0.0",
    );
    await waitFor(() =>
      expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME),
    );

    // Selecting a run of a different workflow (and with no id) drops through to
    // the pipeline-version matcher.
    act(() =>
      childProps.report.handleWorkflowRunSelect({
        id: null,
        workflow: WorkflowType.AMR,
      }),
    );

    await waitFor(() =>
      expect(childProps.header.currentRun.id).toBe(CG_RUN_NEWER.id),
    );
  });

  it("has no current run on a workflow tab the sample never ran", async () => {
    await renderSampleView(
      buildSample({
        initial_workflow: WorkflowType.CONSENSUS_GENOME,
        pipeline_runs: [],
        workflow_runs: [CG_RUN],
      }),
    );
    await waitFor(() =>
      expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME),
    );

    act(() => childProps.tabs.handleTabChange(WORKFLOW_TABS.AMR));

    await waitFor(() =>
      expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.AMR),
    );
    expect(childProps.header.currentRun).toBeUndefined();
  });
});

describe("SampleView -- filters and header wiring", () => {
  it("clears the long-read thresholds on the long-read tab", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.report).toBeTruthy());

    act(() => childProps.tabs.handleTabChange(WORKFLOW_TABS.LONG_READ_MNGS));
    act(() =>
      childProps.report.dispatchSelectedOptions({
        type: "optionChanged",
        payload: {
          key: "thresholdsLongReads",
          value: [{ metric: "b_reads", value: "1", operator: ">=" }],
        },
      }),
    );
    act(() =>
      childProps.report.dispatchSelectedOptions({
        type: "optionChanged",
        payload: {
          key: "thresholdsShortReads",
          value: [{ metric: "nt_r", value: "1", operator: ">=" }],
        },
      }),
    );
    await waitFor(() =>
      expect(
        childProps.report.selectedOptions.thresholdsLongReads,
      ).toHaveLength(1),
    );

    act(() => childProps.report.clearAllFilters());

    await waitFor(() =>
      expect(childProps.report.selectedOptions.thresholdsLongReads).toEqual([]),
    );
    // Short-read thresholds belong to the other tab and are left alone.
    expect(childProps.report.selectedOptions.thresholdsShortReads).toHaveLength(
      1,
    );
  });

  it("leaves both threshold sets alone on a workflow-run tab", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.report).toBeTruthy());

    act(() => childProps.tabs.handleTabChange(WORKFLOW_TABS.CONSENSUS_GENOME));
    act(() =>
      childProps.report.dispatchSelectedOptions({
        type: "optionChanged",
        payload: {
          key: "thresholdsShortReads",
          value: [{ metric: "nt_r", value: "1", operator: ">=" }],
        },
      }),
    );
    await waitFor(() =>
      expect(
        childProps.report.selectedOptions.thresholdsShortReads,
      ).toHaveLength(1),
    );

    act(() => childProps.report.clearAllFilters());

    await waitFor(() =>
      expect(childProps.report.selectedOptions.taxa).toEqual([]),
    );
    expect(childProps.report.selectedOptions.thresholdsShortReads).toHaveLength(
      1,
    );
  });

  it("hands the header a null backgroundId when the selection is not numeric", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.header).toBeTruthy());

    act(() =>
      childProps.report.dispatchSelectedOptions({
        type: "optionChanged",
        payload: { key: "background", value: "not-a-number" },
      }),
    );

    await waitFor(() => expect(childProps.header.backgroundId).toBeNull());
  });
});

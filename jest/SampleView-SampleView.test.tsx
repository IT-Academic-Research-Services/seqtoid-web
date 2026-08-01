// Frontend coverage: app/assets/src/components/views/SampleView/SampleView.tsx
//
// SampleView is the report page's controller: it seeds state from the URL and
// local storage, pulls the sample through Relay, fetches backgrounds / report
// data / project samples / coverage-viz summaries, and hands a large bundle of
// callbacks to five presentational children. Almost none of that is visible in
// the DOM, so every child is stubbed with a prop-capturing double and the
// callbacks are invoked directly -- that is the only way to reach the toggle
// logic (sidebar open vs close, coverage viz open vs close, blast contigs vs
// reads, modal open/close bookkeeping) and the run-selection branches.
//
// Relay is mocked wholesale: useLazyLoadQuery returns a fixture, and fetchQuery
// returns a controllable subscribe() so the consensus-genome kickoff refresh
// can be resolved with both a good and a degenerate response.
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

// ---------------------------------------------------------------- Relay ----
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

// Toasts are the observable side effect of showNotification.
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

// -------------------------------------------------------------- children ---
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

// ----------------------------------------------------------------- setup ---
const mockedGetBackgrounds = getBackgrounds as unknown as jest.Mock;
const mockedGetSampleReportData = getSampleReportData as unknown as jest.Mock;
const mockedGetSamples = getSamples as unknown as jest.Mock;
const mockedGetAmrDeprecatedData = getAmrDeprecatedData as unknown as jest.Mock;
const mockedGetPersistedBackground =
  getPersistedBackground as unknown as jest.Mock;

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
  // SampleView mirrors its state into the URL via history.replaceState, so the
  // query string has to be reset or the next render seeds itself from the
  // previous test's tab/version.
  window.history.replaceState({}, "", "/");
  mockedGetBackgrounds.mockResolvedValue({
    owned_backgrounds: [{ id: 5, name: "Owned BG", mass_normalized: false }],
    other_backgrounds: [{ id: 6, name: "Other BG", mass_normalized: true }],
  });
  mockedGetSampleReportData.mockResolvedValue({
    counts: {
      // SPECIES_LEVEL_INDEX is 1, GENUS_LEVEL_INDEX is 2.
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
  (createPersistedBackground as unknown as jest.Mock).mockResolvedValue({});
  (updatePersistedBackground as unknown as jest.Mock).mockResolvedValue({});
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SampleView -- initial load", () => {
  it("threads the fetched sample, project and backgrounds into its children", async () => {
    await renderSampleView();

    await waitFor(() => expect(childProps.report.backgrounds).toHaveLength(2));
    expect(childProps.header.sample.name).toBe("Sample A");
    expect(childProps.header.project.name).toBe("Project Seven");
    expect(childProps.report.ownedBackgrounds).toHaveLength(1);
    expect(childProps.report.otherBackgrounds).toHaveLength(1);
    // initial_workflow is short-read mNGS with one pipeline run, so that tab wins.
    expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.SHORT_READ_MNGS);
    // The mNGS tab is a pipeline-run tab, so currentRun is the pipeline run.
    expect(childProps.header.currentRun.id).toBe(PIPELINE_RUN.id);
  });

  it("fetches the project's sample list and tolerates a shapeless response", async () => {
    mockedGetSamples.mockResolvedValue(null);
    await renderSampleView();

    await waitFor(() => expect(mockedGetSamples).toHaveBeenCalled());
    // #505 guard: a null response must not blow up the header's .map().
    await waitFor(() => expect(childProps.header.projectSamples).toEqual([]));
  });

  it("processes the raw report into genus rows with species children", async () => {
    await renderSampleView();

    await waitFor(() => expect(childProps.report.reportData).toHaveLength(1));
    const genus = childProps.report.reportData[0];
    expect(genus.taxId).toBe(300);
    expect(genus.species).toHaveLength(1);
    expect(genus.species[0].taxId).toBe(301);
    // 301 was in highlightedTaxIds, so the genus is flagged too.
    expect(genus.species[0].highlighted).toBe(true);
    expect(genus.highlightedChildren).toBe(true);
    expect(childProps.report.loadingReport).toBe(false);
  });

  it("renders an empty report when the response has no sortedGenus", async () => {
    mockedGetSampleReportData.mockResolvedValue({ metadata: {} });
    await renderSampleView();

    await waitFor(() => expect(childProps.report.loadingReport).toBe(false));
    expect(childProps.report.reportData).toEqual([]);
  });

  it("stops the spinner for a sample that never dispatched a pipeline run", async () => {
    await renderSampleView(buildSample({ pipeline_runs: [] }));

    await waitFor(() => expect(childProps.report.loadingReport).toBe(false));
    // No report request is made for a sample with no runs at all.
    expect(mockedGetSampleReportData).not.toHaveBeenCalled();
  });
});

describe("SampleView -- current run selection", () => {
  it("uses the matching workflow run once the consensus genome tab is active", async () => {
    await renderSampleView(
      buildSample({
        initial_workflow: WorkflowType.CONSENSUS_GENOME,
        pipeline_runs: [],
      }),
    );

    await waitFor(() =>
      expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME),
    );
    expect(childProps.header.currentRun.id).toBe(CG_RUN.id);
  });

  it("returns no run when the sample has neither pipeline nor workflow runs", async () => {
    await renderSampleView(
      buildSample({ pipeline_runs: [], workflow_runs: [] }),
    );

    await waitFor(() => expect(childProps.header.currentRun).toBeNull());
    // With no current run the sidebar/modal pair is not mounted at all.
    expect(childProps.sidebar).toBeUndefined();
    expect(childProps.modals).toBeUndefined();
  });
});

describe("SampleView -- taxon details sidebar", () => {
  it("opens the sidebar on a taxon click and closes it on a repeat click", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.sidebar).toBeTruthy());

    act(() => childProps.report.handleTaxonClick({ taxId: 42, name: "T" }));
    await waitFor(() => expect(childProps.sidebar.sidebarVisible).toBe(true));
    expect(childProps.sidebar.sidebarMode).toBe("taxonDetails");
    expect(childProps.sidebar.sidebarTaxonData.taxId).toBe(42);

    act(() => childProps.report.handleTaxonClick({ taxId: 42, name: "T" }));
    await waitFor(() => expect(childProps.sidebar.sidebarVisible).toBe(false));
  });

  it("keeps the sidebar open when a different taxon is clicked", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.sidebar).toBeTruthy());

    act(() => childProps.report.handleTaxonClick({ taxId: 42 }));
    await waitFor(() => expect(childProps.sidebar.sidebarVisible).toBe(true));
    act(() => childProps.report.handleTaxonClick({ taxId: 99 }));
    await waitFor(() =>
      expect(childProps.sidebar.sidebarTaxonData.taxId).toBe(99),
    );
    expect(childProps.sidebar.sidebarVisible).toBe(true);
  });

  it("closes the sidebar when the clicked taxon has no taxId", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.sidebar).toBeTruthy());

    act(() => childProps.report.handleTaxonClick({ taxId: 42 }));
    await waitFor(() => expect(childProps.sidebar.sidebarVisible).toBe(true));
    act(() => childProps.report.handleTaxonClick({}));
    await waitFor(() => expect(childProps.sidebar.sidebarVisible).toBe(false));
  });

  it("toggles the sample details sidebar from the header", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.sidebar).toBeTruthy());

    act(() => childProps.header.onDetailsClick());
    await waitFor(() => expect(childProps.sidebar.sidebarVisible).toBe(true));
    expect(childProps.sidebar.sidebarMode).toBe("sampleDetails");

    act(() => childProps.header.onDetailsClick());
    await waitFor(() => expect(childProps.sidebar.sidebarVisible).toBe(false));
  });

  it("switches a taxon-details sidebar over to sample details rather than closing", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.sidebar).toBeTruthy());

    act(() => childProps.report.handleTaxonClick({ taxId: 42 }));
    await waitFor(() =>
      expect(childProps.sidebar.sidebarMode).toBe("taxonDetails"),
    );
    act(() => childProps.header.onDetailsClick());
    await waitFor(() =>
      expect(childProps.sidebar.sidebarMode).toBe("sampleDetails"),
    );
    expect(childProps.sidebar.sidebarVisible).toBe(true);
  });
});

describe("SampleView -- coverage viz sidebar", () => {
  it("opens the coverage viz for a taxon and closes it on a repeat click", async () => {
    await renderSampleView();

    act(() => childProps.report.handleCoverageVizClick({ taxId: 7 }));
    await waitFor(() => expect(childProps.coverageViz).toBeTruthy());
    expect(childProps.coverageViz.visible).toBe(true);

    act(() => childProps.report.handleCoverageVizClick({ taxId: 7 }));
    await waitFor(() => expect(childProps.coverageViz.visible).toBe(false));
  });

  it("re-targets the coverage viz when a different taxon is clicked", async () => {
    await renderSampleView();

    act(() => childProps.report.handleCoverageVizClick({ taxId: 7 }));
    await waitFor(() => expect(childProps.coverageViz.visible).toBe(true));
    act(() => childProps.report.handleCoverageVizClick({ taxId: 8 }));
    await waitFor(() => expect(childProps.coverageViz.visible).toBe(true));
  });

  it("hides the coverage viz when the click carries no taxId", async () => {
    await renderSampleView();

    act(() => childProps.report.handleCoverageVizClick({ taxId: 7 }));
    await waitFor(() => expect(childProps.coverageViz.visible).toBe(true));
    act(() => childProps.report.handleCoverageVizClick({}));
    await waitFor(() => expect(childProps.coverageViz.visible).toBe(false));
  });
});

describe("SampleView -- modal bookkeeping", () => {
  it("opens the blast selection modal and then the contigs modal", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.modals).toBeTruthy());

    act(() => childProps.report.handleBlastClick({ taxName: "T" }));
    await waitFor(() =>
      expect(childProps.modals.modalsVisible.blastSelection).toBe(true),
    );
    expect(childProps.modals.blastData.taxName).toBe("T");

    act(() =>
      childProps.modals.handleBlastSelectionModalContinue({
        shouldBlastContigs: true,
      }),
    );
    await waitFor(() =>
      expect(childProps.modals.modalsVisible.blastContigs).toBe(true),
    );
    expect(childProps.modals.modalsVisible.blastSelection).toBe(false);
    expect(childProps.modals.modalsVisible.blastReads).toBe(false);
  });

  it("opens the reads modal when contigs are not selected", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.modals).toBeTruthy());

    act(() => childProps.report.handleBlastClick({ taxName: "T" }));
    await waitFor(() =>
      expect(childProps.modals.modalsVisible.blastSelection).toBe(true),
    );
    act(() =>
      childProps.modals.handleBlastSelectionModalContinue({
        shouldBlastContigs: false,
      }),
    );
    await waitFor(() =>
      expect(childProps.modals.modalsVisible.blastReads).toBe(true),
    );
    expect(childProps.modals.modalsVisible.blastContigs).toBe(false);
  });

  it("opens the consensus genome creation modal with the taxon's used accessions", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.modals).toBeTruthy());

    act(() =>
      childProps.modals.handleConsensusGenomeClick({
        percentIdentity: 99,
        taxId: 2697049,
        taxName: "SARS-CoV-2",
      }),
    );

    await waitFor(() =>
      expect(childProps.modals.modalsVisible.consensusGenomeCreation).toBe(
        true,
      ),
    );
    expect(childProps.modals.consensusGenomeData.taxName).toBe("SARS-CoV-2");
    expect(childProps.modals.consensusGenomeData.usedAccessions).toEqual([
      "MN908947.3",
    ]);
  });

  it("opens the previous-runs modal and then jumps to the chosen run", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.modals).toBeTruthy());

    act(() =>
      childProps.report.handlePreviousConsensusGenomeClick(
        { percentIdentity: 98, taxId: 2697049, taxName: "SARS-CoV-2" },
        buildSample(),
      ),
    );
    await waitFor(() =>
      expect(childProps.modals.modalsVisible.consensusGenomePrevious).toBe(
        true,
      ),
    );
    expect(childProps.modals.consensusGenomePreviousParams.taxId).toBe(2697049);

    act(() =>
      childProps.modals.handlePreviousConsensusGenomeReportClick({
        rowData: CG_RUN,
      }),
    );
    await waitFor(() =>
      expect(childProps.modals.modalsVisible.consensusGenomePrevious).toBe(
        false,
      ),
    );
    expect(childProps.tabs.currentTab).toBe(WORKFLOW_TABS.CONSENSUS_GENOME);
  });
});

describe("SampleView -- consensus genome kickoff refresh", () => {
  it("swaps in the refreshed workflow runs and toasts the user", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.modals).toBeTruthy());

    await act(async () => {
      await childProps.modals.handleConsensusGenomeKickoff(buildSample());
    });
    expect(mockSubscribeHandlers).toBeTruthy();

    const newRun = { ...CG_RUN, id: 99 };
    act(() =>
      mockSubscribeHandlers.next({
        SampleForReport: { ...buildSample(), workflow_runs: [newRun] },
      }),
    );

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    expect(childProps.modals.sample.workflow_runs[0].id).toBe(99);
  });

  it("logs and keeps the old runs when the refresh comes back empty", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.modals).toBeTruthy());

    await act(async () => {
      await childProps.modals.handleConsensusGenomeKickoff(buildSample());
    });
    act(() => mockSubscribeHandlers.next({ SampleForReport: null }));

    expect(console.error).toHaveBeenCalledWith(
      "Error fetching updated sample",
      { SampleForReport: null },
    );
    expect(childProps.modals.sample.workflow_runs[0].id).toBe(CG_RUN.id);
  });

  it("logs a failed refresh subscription", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.modals).toBeTruthy());

    await act(async () => {
      await childProps.modals.handleConsensusGenomeKickoff(buildSample());
    });
    const failure = new Error("network down");
    act(() => mockSubscribeHandlers.error(failure));

    expect(console.error).toHaveBeenCalledWith(
      "Error fetching updated sample",
      failure,
    );
  });
});

describe("SampleView -- pipeline version selection", () => {
  it("ignores a re-selection of the version already in use", async () => {
    await renderSampleView();
    const runIdBefore = childProps.header.currentRun.id;

    // pipelineVersion starts undefined (nothing in the URL); re-selecting it is
    // an early return, so no "no run found" complaint is logged.
    act(() => childProps.header.onPipelineVersionChange(undefined));

    await waitFor(() =>
      expect(childProps.header.currentRun.id).toBe(runIdBefore),
    );
    expect(console.error).not.toHaveBeenCalledWith(
      "No run found for the selected pipeline version",
    );
  });

  it("logs when no mNGS run matches the requested version", async () => {
    await renderSampleView();

    act(() => childProps.header.onPipelineVersionChange("99.0"));

    await waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "No run found for the selected pipeline version",
      ),
    );
  });

  it("switches the pipeline run when a matching mNGS version exists", async () => {
    const olderRun = { ...PIPELINE_RUN, id: 12, pipeline_version: "7.1" };
    await renderSampleView(
      buildSample({ pipeline_runs: [PIPELINE_RUN, olderRun] }),
    );

    act(() => childProps.header.onPipelineVersionChange("7.1"));

    await waitFor(() => expect(childProps.header.currentRun.id).toBe(12));
    // The switch also re-requests the report for the newly selected version.
    await waitFor(() =>
      expect(mockedGetSampleReportData).toHaveBeenCalledWith(
        expect.objectContaining({ pipelineVersion: "7.1" }),
      ),
    );
  });
});

describe("SampleView -- report actions", () => {
  it("builds a CSV object URL for the filtered report", async () => {
    await renderSampleView();

    const url =
      childProps.header.getDownloadReportTableWithAppliedFiltersLink();
    expect(url).toBe("blob:csv-url");
  });

  it("switches the report view and tracks the click", async () => {
    await renderSampleView();
    expect(childProps.report.view).toBe("table");

    act(() => childProps.report.handleViewClick({ view: "tree" }));

    await waitFor(() => expect(childProps.report.view).toBe("tree"));
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "PipelineSampleReport_tree-view-menu_clicked",
    );
  });

  it("renames the sample in place on a metadata name update", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.sidebar).toBeTruthy());

    act(() => childProps.sidebar.handleMetadataUpdate("name", "Renamed"));
    await waitFor(() => expect(childProps.header.sample.name).toBe("Renamed"));
  });

  it("leaves the sample untouched for non-name metadata updates", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.sidebar).toBeTruthy());

    act(() => childProps.sidebar.handleMetadataUpdate("host", "Human"));
    await waitFor(() => expect(childProps.header.sample.name).toBe("Sample A"));
  });

  it("clears taxa, category and threshold filters", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.report.reportData).toHaveLength(1));

    act(() => childProps.report.clearAllFilters());

    await waitFor(() =>
      expect(childProps.report.selectedOptions.taxa).toEqual([]),
    );
    expect(childProps.report.selectedOptions.categories).toEqual({});
    expect(childProps.report.selectedOptions.thresholdsShortReads).toEqual([]);
    expect(childProps.report.selectedOptions.annotations).toEqual([]);
  });

  it("selects a workflow run handed up from the report panel", async () => {
    const otherRun = { ...CG_RUN, id: 22 };
    await renderSampleView(
      buildSample({
        initial_workflow: WorkflowType.CONSENSUS_GENOME,
        pipeline_runs: [],
        workflow_runs: [CG_RUN, otherRun],
      }),
    );
    await waitFor(() => expect(childProps.header.currentRun.id).toBe(21));

    act(() => childProps.report.handleWorkflowRunSelect(otherRun));

    await waitFor(() => expect(childProps.header.currentRun.id).toBe(22));
  });
});

describe("SampleView -- optimistic annotation update", () => {
  // SMP-1605: setting an annotation used to trigger a full report refetch, so
  // the label only changed after the heavy round-trip finished. It now patches
  // just the affected taxon in local report state (the backend mutation has
  // already persisted the value), so the change is visible immediately.
  it("applies a species annotation in place without refetching the report", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.report.reportData).toHaveLength(1));
    const callsAfterLoad = mockedGetSampleReportData.mock.calls.length;

    act(() => childProps.report.handleAnnotationUpdate(301, "hit"));

    await waitFor(() =>
      expect(childProps.report.reportData[0].species[0].annotation).toBe("hit"),
    );
    // The genus row itself is untouched.
    expect(childProps.report.reportData[0].annotation).toBeUndefined();
    // The change flows through to the filtered data the table actually renders.
    expect(
      childProps.report.filteredReportData[0].filteredSpecies[0].annotation,
    ).toBe("hit");
    // No extra report request: the whole point of the fix.
    expect(mockedGetSampleReportData.mock.calls.length).toBe(callsAfterLoad);
  });

  it("applies a genus-level annotation to the matching genus row", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.report.reportData).toHaveLength(1));

    act(() => childProps.report.handleAnnotationUpdate(300, "inconclusive"));

    await waitFor(() =>
      expect(childProps.report.reportData[0].annotation).toBe("inconclusive"),
    );
    // The nested species is left alone.
    expect(childProps.report.reportData[0].species[0].annotation).toBeUndefined();
  });

  it("clears a taxon's annotation when 'None' is chosen (null type)", async () => {
    await renderSampleView();
    await waitFor(() => expect(childProps.report.reportData).toHaveLength(1));
    act(() => childProps.report.handleAnnotationUpdate(301, "hit"));
    await waitFor(() =>
      expect(childProps.report.reportData[0].species[0].annotation).toBe("hit"),
    );

    act(() => childProps.report.handleAnnotationUpdate(301, null));

    await waitFor(() =>
      expect(
        childProps.report.reportData[0].species[0].annotation,
      ).toBeUndefined(),
    );
  });
});

describe("SampleView -- report fetch failures", () => {
  it("reports an invalid background when the report request throws", async () => {
    mockedGetSampleReportData.mockRejectedValue(new Error("boom"));
    await renderSampleView();

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    expect(console.error).toHaveBeenCalled();
    expect(childProps.report.reportData).toEqual([]);
  });
});

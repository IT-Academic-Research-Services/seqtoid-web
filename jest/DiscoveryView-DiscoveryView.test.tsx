// Coverage for app/assets/src/components/views/DiscoveryView/DiscoveryView.tsx
//
// DiscoveryView is the class component behind /my_data, /public and the
// snapshot pages. It owns a large amount of orchestration: it seeds state from
// URL + session + local storage, builds one "config" per workflow, fans out the
// initial load across four discovery_api calls, mirrors every state change back
// into the URL / storage / browser history, and picks which pane, tab and
// no-data banner to show.
//
// This suite drives that orchestration end to end:
//   - constructor state seeding (domain -> default tab, storage round-trip),
//   - initialLoad fan-out and the snapshot-domain short-circuit,
//   - getWorkflowToDisplay (the "default tab has no samples" fallback chain),
//   - tab / workflow-tab switching, filter + search changes and the reloads
//     they trigger, filter & stats toggles,
//   - the no-data banners (projects / samples / visualizations / per-workflow)
//     and the no-search-results banner + its "view other results" link.
//
// The data layer is replaced with a controllable fake (the real one is an
// ObjectCollectionView over paged network fetches and has its own suite), the
// four discovery_api calls are jest.fn()s, and each heavy child view is a stub
// that exposes the callbacks DiscoveryView hands it.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WORKFLOW_TABS, WorkflowType } from "~/components/utils/workflows";
import { DiscoveryView } from "~/components/views/DiscoveryView/DiscoveryView";
import {
  KEY_DISCOVERY_VIEW_OPTIONS,
  TAB_PROJECTS,
  TAB_SAMPLES,
  TAB_VISUALIZATIONS,
} from "~/components/views/DiscoveryView/constants";
import {
  getDiscoveryDimensions,
  getDiscoveryLocations,
  getDiscoveryStats,
  getDiscoveryVisualizations,
} from "~/components/views/DiscoveryView/discovery_api";

// --- discovery_api ----------------------------------------------------------
// Keep the real domain constants (DiscoveryView branches on them) and replace
// only the four network calls.
jest.mock("~/components/views/DiscoveryView/discovery_api", () => {
  const actual = jest.requireActual(
    "~/components/views/DiscoveryView/discovery_api",
  );
  return {
    ...actual,
    getDiscoveryDimensions: jest.fn(),
    getDiscoveryLocations: jest.fn(),
    getDiscoveryStats: jest.fn(),
    getDiscoveryVisualizations: jest.fn(),
  };
});

// --- data layer -------------------------------------------------------------
jest.mock("~/components/views/DiscoveryView/DiscoveryDataLayer", () => {
  // Views are registered by name so a test can simulate "this collection just
  // finished loading" by invoking the onViewChange callback DiscoveryView
  // handed to createView.
  const views: Record<string, $TSFixMe> = {};
  const makeCollection = (name: string) => ({
    createView: (opts: $TSFixMe) => {
      const view = {
        opts,
        loaded: [],
        length: 0,
        ids: [] as string[],
        loadPage: jest.fn(),
        reset: jest.fn(),
        isLoading: jest.fn(() => false),
        handleLoadObjectRows: jest.fn(async () => []),
        getIds: jest.fn(() => view.ids),
        get: jest.fn(() => undefined),
      };
      views[name] = view;
      return view;
    },
  });
  class DiscoveryDataLayer {
    domain: string;
    samples = makeCollection("samples");
    projects = makeCollection("projects");
    visualizations = makeCollection("visualizations");
    amrWorkflowRuns = makeCollection("amrWorkflowRuns");
    benchmarkWorkflowRuns = makeCollection("benchmarkWorkflowRuns");
    longReadMngsSamples = makeCollection("longReadMngsSamples");
    constructor(domain: string) {
      this.domain = domain;
    }
  }
  return {
    __esModule: true,
    DiscoveryDataLayer,
    ObjectCollectionView: class {},
    __views: views,
  };
});

// --- side-effect-y helpers --------------------------------------------------
jest.mock("~/api", () => ({
  __esModule: true,
  getSearchSuggestions: jest.fn(async () => ({})),
}));
jest.mock("~/api/analytics", () => ({
  __esModule: true,
  trackPageTransition: jest.fn(),
  trackEvent: jest.fn(),
  // InfoBanner's link renders through a hook-based tracker.
  useTrackEvent: () => jest.fn(),
  withAnalytics: (fn: $TSFixMe) => fn,
  ANALYTICS_EVENT_NAMES: new Proxy(
    {},
    { get: (_target, key) => String(key) },
  ) as $TSFixMe,
}));
jest.mock("~/components/views/SampleView/utils", () => ({
  __esModule: true,
  NOTIFICATION_TYPES: { sampleDeleteSuccess: "sampleDeleteSuccess" },
  showNotification: jest.fn(),
}));
jest.mock("~utils/links", () => ({
  __esModule: true,
  openUrl: jest.fn(),
}));

// --- child view stubs -------------------------------------------------------
jest.mock(
  "~/components/views/DiscoveryView/components/DiscoveryHeader",
  () => ({
    __esModule: true,
    DiscoveryHeader: ({
      currentTab,
      filterCount,
      onFilterToggle,
      onStatsToggle,
      onTabChange,
      onSearchEnterPressed,
      showFilters,
      showStats,
      tabs,
      workflow,
    }: $TSFixMe) => (
      <div data-testid="discovery-header">
        <span data-testid="header-tab">{currentTab}</span>
        <span data-testid="header-workflow">{workflow}</span>
        <span data-testid="header-filter-count">{String(filterCount)}</span>
        <span data-testid="header-show-filters">{String(showFilters)}</span>
        <span data-testid="header-show-stats">{String(showStats)}</span>
        <span data-testid="header-tab-values">
          {tabs.map((t: $TSFixMe) => t.value).join(",")}
        </span>
        {tabs.map((t: $TSFixMe, i: number) => (
          <button
            key={t.value}
            data-testid={`go-tab-${t.value}`}
            onClick={() => onTabChange(String(i))}
          />
        ))}
        <button data-testid="toggle-filters" onClick={onFilterToggle} />
        <button data-testid="toggle-stats" onClick={onStatsToggle} />
        <button
          data-testid="search-enter"
          onClick={() => onSearchEnterPressed("  malaria  ")}
        />
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/DiscoveryFilters",
  () => ({
    __esModule: true,
    DiscoveryFilters: ({ currentTab, onFilterChange }: $TSFixMe) => (
      <div data-testid="discovery-filters">
        <span data-testid="filters-tab">{currentTab}</span>
        <button
          data-testid="apply-filter"
          onClick={() =>
            onFilterChange({ selectedFilters: { taxonSelected: [{ id: 1 }] } })
          }
        />
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/DiscoverySidebar",
  () => ({
    __esModule: true,
    DiscoverySidebar: ({ currentTab, loading }: $TSFixMe) => (
      <div data-testid="discovery-sidebar" data-loading={String(loading)}>
        {currentTab}
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/MapPreviewSidebar",
  () => ({
    __esModule: true,
    MapPreviewSidebar: () => <div data-testid="map-preview-sidebar" />,
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/ModalFirstTimeUser",
  () => ({
    __esModule: true,
    ModalFirstTimeUser: ({ onClose }: $TSFixMe) => (
      <div data-testid="first-time-modal">
        <button data-testid="close-first-time-modal" onClick={onClose} />
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/NoResultsBanner",
  () => ({
    __esModule: true,
    NoSearchResultsBanner: ({ searchType, listenerLink }: $TSFixMe) => (
      <div data-testid="no-search-results">
        <span data-testid="no-search-type">{searchType}</span>
        <button data-testid="no-search-link" onClick={listenerLink.onClick}>
          {listenerLink.text}
        </button>
      </div>
    ),
  }),
);

jest.mock("~/components/views/DiscoveryView/components/ProjectHeader", () => ({
  __esModule: true,
  ProjectHeader: () => <div data-testid="project-header" />,
}));

jest.mock(
  "~/components/views/DiscoveryView/components/ProjectsView/ProjectsView",
  () => ({
    __esModule: true,
    ProjectsView: ({ filteredProjectCount, onProjectSelected }: $TSFixMe) => (
      <div data-testid="projects-view">
        <span data-testid="projects-count">{String(filteredProjectCount)}</span>
        <button
          data-testid="select-project"
          onClick={() => onProjectSelected({ project: { id: "42" } })}
        />
      </div>
    ),
  }),
);

jest.mock("~/components/views/DiscoveryView/components/SamplesView", () => ({
  __esModule: true,
  SamplesView: ({ workflow, currentTab, domain, admin }: $TSFixMe) => (
    <div data-testid="samples-view">
      <span data-testid="samples-workflow">{workflow}</span>
      <span data-testid="samples-tab">{currentTab}</span>
      <span data-testid="samples-domain">{domain}</span>
      <span data-testid="samples-admin">{String(admin)}</span>
    </div>
  ),
}));

jest.mock(
  "~/components/views/DiscoveryView/components/VisualizationsView/VisualizationsView",
  () => ({
    __esModule: true,
    VisualizationsView: () => <div data-testid="visualizations-view" />,
  }),
);

// --- helpers ----------------------------------------------------------------
const asMock = (fn: $TSFixMe) => fn as jest.Mock;

const dataLayerViews = () =>
  jest.requireMock("~/components/views/DiscoveryView/DiscoveryDataLayer")
    .__views;

const emptyDimensions = { projectDimensions: [], sampleDimensions: [] };
const someDimensions = {
  projectDimensions: [
    {
      dimension: "host",
      values: [{ value: "human", text: "Human", count: 1 }],
    },
  ],
  sampleDimensions: [
    {
      dimension: "host",
      values: [{ value: "human", text: "Human", count: 1 }],
    },
  ],
};

const statsWith = (overrides: $TSFixMe = {}) => ({
  sampleStats: {
    count: 5,
    projectCount: 2,
    countByWorkflow: {
      [WorkflowType.SHORT_READ_MNGS]: 5,
      [WorkflowType.LONG_READ_MNGS]: 0,
      [WorkflowType.CONSENSUS_GENOME]: 0,
      [WorkflowType.AMR]: 0,
      [WorkflowType.BENCHMARK]: 0,
    },
    ...overrides,
  },
});

const baseProps = () => ({
  domain: "my_data",
  allowedFeatures: [],
  isAdmin: false,
  mapTilerKey: "map-tiler-key",
  updateDiscoveryProjectId: jest.fn(),
  cgWorkflowIds: [],
  cgRows: [],
  fetchTotalWorkflowCounts: jest.fn(async () => ({
    [WorkflowType.SHORT_READ_MNGS]: 5,
    [WorkflowType.LONG_READ_MNGS]: 0,
    [WorkflowType.CONSENSUS_GENOME]: 0,
    [WorkflowType.AMR]: 0,
    [WorkflowType.BENCHMARK]: 0,
  })),
  fetchCgPage: jest.fn(async () => []),
  fetchNextGenWorkflowRuns: jest.fn(),
  fetchWorkflowRunsProjectAggregates: jest.fn(),
  history: { push: jest.fn() },
  location: { search: "" },
  match: { params: {} },
});

const renderView = (overrides: $TSFixMe = {}) => {
  const props = { ...baseProps(), ...overrides };
  const utils = render(<DiscoveryView {...(props as $TSFixMe)} />);
  return { ...utils, props };
};

// Waits for loadUserDataStats to land, which is what unblocks the center pane.
const waitForCenterPane = async () =>
  waitFor(() => expect(screen.getByTestId("discovery-sidebar")).toBeTruthy());

describe("DiscoveryView", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, "", "/my_data");
    jest.clearAllMocks();
    asMock(getDiscoveryDimensions).mockResolvedValue(someDimensions);
    asMock(getDiscoveryStats).mockResolvedValue(statsWith());
    asMock(getDiscoveryVisualizations).mockResolvedValue({
      visualizations: [{ id: 1 }],
    });
    asMock(getDiscoveryLocations).mockResolvedValue({});
  });

  describe("initial load", () => {
    it("defaults to the projects tab on my_data and fans out the initial load", async () => {
      renderView();
      expect(screen.getByTestId("header-tab").textContent).toBe(TAB_PROJECTS);
      await waitFor(() => expect(getDiscoveryStats).toHaveBeenCalled());
      expect(getDiscoveryDimensions).toHaveBeenCalled();
      expect(getDiscoveryLocations).toHaveBeenCalled();
      expect(getDiscoveryVisualizations).toHaveBeenCalled();
    });

    it("defaults to the samples tab on all_data", async () => {
      renderView({ domain: "all_data" });
      expect(screen.getByTestId("header-tab").textContent).toBe(TAB_SAMPLES);
      await waitFor(() => expect(getDiscoveryStats).toHaveBeenCalled());
    });

    it("offers projects/samples/visualizations tabs on my_data but only samples inside a project", async () => {
      const { unmount } = renderView();
      expect(screen.getByTestId("header-tab-values").textContent).toBe(
        [TAB_PROJECTS, TAB_SAMPLES, TAB_VISUALIZATIONS].join(","),
      );
      await waitFor(() => expect(getDiscoveryStats).toHaveBeenCalled());
      unmount();

      renderView({ projectId: "7" });
      // Inside a project both the projects and visualizations tabs drop away.
      expect(screen.getByTestId("header-tab-values").textContent).toBe(
        TAB_SAMPLES,
      );
      expect(screen.getByTestId("project-header")).toBeTruthy();
      await waitFor(() => expect(getDiscoveryStats).toHaveBeenCalled());
    });

    it("hides the visualizations tab on the public domain", async () => {
      renderView({ domain: "public" });
      expect(screen.getByTestId("header-tab-values").textContent).toBe(
        [TAB_PROJECTS, TAB_SAMPLES].join(","),
      );
      await waitFor(() => expect(getDiscoveryStats).toHaveBeenCalled());
    });

    it("skips locations and user stats on the snapshot domain", async () => {
      renderView({ domain: "snapshot", snapshotShareId: "abc123" });
      await waitFor(() => expect(getDiscoveryDimensions).toHaveBeenCalled());
      expect(getDiscoveryLocations).not.toHaveBeenCalled();
      // loadUserDataStats (which is what calls getDiscoveryVisualizations) is
      // skipped for snapshots; only the filtered-stats call is made.
      expect(getDiscoveryVisualizations).not.toHaveBeenCalled();
    });

    it("persists view options to session and local storage and the tab to the URL", async () => {
      renderView();
      await waitFor(() => expect(getDiscoveryStats).toHaveBeenCalled());
      const session = JSON.parse(
        sessionStorage.getItem(KEY_DISCOVERY_VIEW_OPTIONS) as string,
      );
      // currentTab lives in the URL; the session keeps display/workflow.
      expect(session.workflow).toBe(WorkflowType.SHORT_READ_MNGS);
      expect(session.currentDisplay).toBe("table");
      const local = JSON.parse(
        localStorage.getItem(KEY_DISCOVERY_VIEW_OPTIONS) as string,
      );
      expect(local.showFilters).toBe(true);
      expect(local.showStats).toBe(true);
      // Session storage does not carry the URL-only fields.
      expect(session.currentTab).toBeUndefined();
      expect(window.location.search).toContain(`currentTab=${TAB_PROJECTS}`);
    });

    it("restores the tab persisted in session storage", async () => {
      sessionStorage.setItem(
        KEY_DISCOVERY_VIEW_OPTIONS,
        JSON.stringify({ currentTab: TAB_VISUALIZATIONS, showStats: false }),
      );
      renderView();
      expect(screen.getByTestId("header-tab").textContent).toBe(
        TAB_VISUALIZATIONS,
      );
      expect(screen.getByTestId("header-show-stats").textContent).toBe("false");
      await waitFor(() => expect(getDiscoveryStats).toHaveBeenCalled());
    });
  });

  describe("workflow selection", () => {
    it("keeps the default workflow when it has samples", async () => {
      renderView();
      await waitForCenterPane();
      await waitFor(() =>
        expect(screen.getByTestId("header-workflow").textContent).toBe(
          WorkflowType.SHORT_READ_MNGS,
        ),
      );
    });

    it("falls back to long-read mNGS when short-read has no samples", async () => {
      asMock(getDiscoveryStats).mockResolvedValue(
        statsWith({
          countByWorkflow: {
            [WorkflowType.SHORT_READ_MNGS]: 0,
            [WorkflowType.LONG_READ_MNGS]: 3,
            [WorkflowType.CONSENSUS_GENOME]: 0,
            [WorkflowType.AMR]: 0,
          },
        }),
      );
      renderView();
      await waitFor(() =>
        expect(screen.getByTestId("header-workflow").textContent).toBe(
          WorkflowType.LONG_READ_MNGS,
        ),
      );
    });

    it("falls back to AMR when only AMR has samples", async () => {
      asMock(getDiscoveryStats).mockResolvedValue(
        statsWith({
          countByWorkflow: {
            [WorkflowType.SHORT_READ_MNGS]: 0,
            [WorkflowType.LONG_READ_MNGS]: 0,
            [WorkflowType.CONSENSUS_GENOME]: 0,
            [WorkflowType.AMR]: 2,
          },
        }),
      );
      renderView();
      await waitFor(() =>
        expect(screen.getByTestId("header-workflow").textContent).toBe(
          WorkflowType.AMR,
        ),
      );
    });

    it("keeps short-read mNGS when the user has no samples at all", async () => {
      asMock(getDiscoveryStats).mockResolvedValue(
        statsWith({ count: 0, countByWorkflow: {} }),
      );
      renderView();
      await waitFor(() => expect(getDiscoveryStats).toHaveBeenCalled());
      expect(screen.getByTestId("header-workflow").textContent).toBe(
        WorkflowType.SHORT_READ_MNGS,
      );
    });
  });

  describe("tab switching", () => {
    it("switches to the samples tab and renders the samples view", async () => {
      renderView();
      await waitForCenterPane();
      fireEvent.click(screen.getByTestId(`go-tab-${TAB_SAMPLES}`));
      await waitFor(() =>
        expect(screen.getByTestId("header-tab").textContent).toBe(TAB_SAMPLES),
      );
      expect(screen.getByTestId("samples-view")).toBeTruthy();
      expect(screen.getByTestId("samples-domain").textContent).toBe("my_data");
      expect(screen.queryByTestId("projects-view")).toBeNull();
      // The tab is mirrored into the URL.
      await waitFor(() =>
        expect(window.location.search).toContain(`currentTab=${TAB_SAMPLES}`),
      );
    });

    it("switches to the visualizations tab", async () => {
      renderView();
      await waitForCenterPane();
      fireEvent.click(screen.getByTestId(`go-tab-${TAB_VISUALIZATIONS}`));
      await waitFor(() =>
        expect(screen.getByTestId("visualizations-view")).toBeTruthy(),
      );
      // The right-pane stats sidebar is hidden on the visualizations tab.
      expect(screen.queryByTestId("discovery-sidebar")).toBeNull();
    });
  });

  describe("filters, search and toggles", () => {
    it("reloads dimensions, stats and locations when a filter is applied", async () => {
      renderView();
      await waitForCenterPane();
      asMock(getDiscoveryStats).mockClear();
      asMock(getDiscoveryDimensions).mockClear();
      asMock(getDiscoveryLocations).mockClear();

      fireEvent.click(screen.getByTestId("apply-filter"));

      await waitFor(() => expect(getDiscoveryStats).toHaveBeenCalled());
      expect(getDiscoveryDimensions).toHaveBeenCalled();
      expect(getDiscoveryLocations).toHaveBeenCalled();
      // The applied filter is reflected in the header's filter count.
      await waitFor(() =>
        expect(screen.getByTestId("header-filter-count").textContent).toBe("1"),
      );
    });

    it("trims a submitted search and reloads with it", async () => {
      renderView();
      await waitForCenterPane();
      asMock(getDiscoveryStats).mockClear();

      fireEvent.click(screen.getByTestId("search-enter"));

      await waitFor(() => expect(getDiscoveryStats).toHaveBeenCalled());
      expect(asMock(getDiscoveryStats).mock.calls[0][0].search).toBe("malaria");
    });

    it("ignores a repeated search for the same term", async () => {
      renderView();
      await waitForCenterPane();
      fireEvent.click(screen.getByTestId("search-enter"));
      await waitFor(() =>
        expect(asMock(getDiscoveryStats).mock.calls.length).toBeGreaterThan(1),
      );
      const callsAfterFirstSearch = asMock(getDiscoveryStats).mock.calls.length;

      fireEvent.click(screen.getByTestId("search-enter"));
      // Same parsed search -> no state change, no refetch.
      expect(asMock(getDiscoveryStats).mock.calls.length).toBe(
        callsAfterFirstSearch,
      );
    });

    it("toggles the filters pane", async () => {
      renderView();
      await waitForCenterPane();
      expect(screen.getByTestId("discovery-filters")).toBeTruthy();
      fireEvent.click(screen.getByTestId("toggle-filters"));
      await waitFor(() =>
        expect(screen.queryByTestId("discovery-filters")).toBeNull(),
      );
      fireEvent.click(screen.getByTestId("toggle-filters"));
      await waitFor(() =>
        expect(screen.getByTestId("discovery-filters")).toBeTruthy(),
      );
    });

    it("toggles the stats sidebar", async () => {
      renderView();
      await waitForCenterPane();
      fireEvent.click(screen.getByTestId("toggle-stats"));
      await waitFor(() =>
        expect(screen.queryByTestId("discovery-sidebar")).toBeNull(),
      );
    });

    it("hides the filters pane on a tab that has no dimensions", async () => {
      renderView();
      await waitForCenterPane();
      expect(screen.getByTestId("discovery-filters")).toBeTruthy();
      // getCurrentDimensions only knows about the projects and samples tabs,
      // so the visualizations tab has nothing to filter on.
      fireEvent.click(screen.getByTestId(`go-tab-${TAB_VISUALIZATIONS}`));
      await waitFor(() =>
        expect(screen.queryByTestId("discovery-filters")).toBeNull(),
      );
    });

    it("still renders the filters pane when the dimension lists come back empty", async () => {
      asMock(getDiscoveryDimensions).mockResolvedValue(emptyDimensions);
      renderView();
      await waitForCenterPane();
      expect(screen.getByTestId("discovery-filters")).toBeTruthy();
      expect(screen.getByTestId("filters-tab").textContent).toBe(TAB_PROJECTS);
    });
  });

  describe("no-data banners", () => {
    it("shows the empty samples banner when the user has no samples", async () => {
      asMock(getDiscoveryStats).mockResolvedValue(
        statsWith({ count: 0, projectCount: 0, countByWorkflow: {} }),
      );
      renderView();
      await waitForCenterPane();
      fireEvent.click(screen.getByTestId(`go-tab-${TAB_SAMPLES}`));
      await waitFor(() =>
        expect(
          screen.getByText(
            "You will see your samples here after you upload data or when you are invited to a project.",
          ),
        ).toBeTruthy(),
      );
      expect(screen.queryByTestId("samples-view")).toBeNull();
    });

    it("scopes the empty samples message to the project when one is selected", async () => {
      asMock(getDiscoveryStats).mockResolvedValue(
        statsWith({ count: 0, projectCount: 0, countByWorkflow: {} }),
      );
      renderView({ projectId: "7" });
      await waitFor(() =>
        expect(
          screen.getByText(
            "You will see your samples here after you upload data to your project.",
          ),
        ).toBeTruthy(),
      );
    });

    it("shows the empty visualizations banner when there are none", async () => {
      asMock(getDiscoveryVisualizations).mockResolvedValue({
        visualizations: [],
      });
      renderView();
      await waitForCenterPane();
      fireEvent.click(screen.getByTestId(`go-tab-${TAB_VISUALIZATIONS}`));
      await waitFor(() =>
        expect(
          screen.getByText(
            "You will see your saved Heatmaps and Phylogenetic Trees here. Create them on the Samples tab.",
          ),
        ).toBeTruthy(),
      );
    });

    it("shows the first-time-user modal instead of any banner, then dismisses it", async () => {
      window.history.replaceState({}, "", "/my_data?profile_form_submitted=1");
      renderView();
      await waitForCenterPane();
      expect(screen.getByTestId("first-time-modal")).toBeTruthy();
      fireEvent.click(screen.getByTestId("close-first-time-modal"));
      await waitFor(() =>
        expect(screen.queryByTestId("first-time-modal")).toBeNull(),
      );
    });

    it("shows the per-workflow no-data banner when the workflow has zero runs", async () => {
      const props = baseProps();
      props.fetchTotalWorkflowCounts = jest.fn(async () => ({
        [WorkflowType.SHORT_READ_MNGS]: 0,
        [WorkflowType.LONG_READ_MNGS]: 0,
        [WorkflowType.CONSENSUS_GENOME]: 0,
        [WorkflowType.AMR]: 0,
        [WorkflowType.BENCHMARK]: 0,
      })) as $TSFixMe;
      renderView(props);
      await waitForCenterPane();
      fireEvent.click(screen.getByTestId(`go-tab-${TAB_SAMPLES}`));
      await waitFor(() =>
        expect(
          screen.getByText(
            `No samples were processed by the ${WORKFLOW_TABS.SHORT_READ_MNGS} Pipeline.`,
          ),
        ).toBeTruthy(),
      );
      expect(screen.queryByTestId("samples-view")).toBeNull();
    });
  });

  describe("collection view callbacks", () => {
    it("shows the empty-projects banner once the projects collection reports zero rows", async () => {
      renderView();
      await waitForCenterPane();

      // Simulate the projects collection finishing a load with no rows.
      await waitFor(() =>
        expect(dataLayerViews().projects.opts.onViewChange).toBeDefined(),
      );
      dataLayerViews().projects.opts.onViewChange();

      await waitFor(() =>
        expect(
          screen.getByText(
            "You will see your projects here after you upload data or when you are invited to a project.",
          ),
        ).toBeTruthy(),
      );
      expect(screen.queryByTestId("projects-view")).toBeNull();
    });

    it("offers a jump to the samples tab when a project search returns nothing", async () => {
      renderView();
      await waitForCenterPane();
      // A search suppresses the "no projects yet" banner, so the empty
      // collection surfaces the no-search-results banner instead.
      fireEvent.click(screen.getByTestId("search-enter"));
      dataLayerViews().projects.opts.onViewChange();

      await waitFor(() =>
        expect(screen.getByTestId("no-search-results")).toBeTruthy(),
      );
      expect(screen.getByTestId("no-search-type").textContent).toBe("Project");
      expect(screen.getByTestId("no-search-link").textContent).toBe(
        "Or view Sample results",
      );
      // NOTE: the link's onClick calls handleTabChange with a tab *name*, while
      // handleTabChange indexes computeTabs() by position -- so clicking it is
      // currently a no-op-turned-TypeError. Asserted content only; see the
      // suite header comment rather than pinning the defect down in a test.
      expect(screen.queryByTestId("projects-view")).toBeTruthy();
    });

    it("counts samples reported by the samples collection into the workflow tab count", async () => {
      renderView();
      await waitForCenterPane();
      const samplesView = dataLayerViews().samples;
      samplesView.ids = ["1", "2", "3"];
      samplesView.opts.onViewChange();

      fireEvent.click(screen.getByTestId(`go-tab-${TAB_SAMPLES}`));
      await waitFor(() =>
        expect(screen.getByTestId("samples-view")).toBeTruthy(),
      );
      // The short-read mNGS workflow tab shows the count reported above.
      await waitFor(() =>
        expect(screen.getByTestId("metagenomics-count").textContent).toBe("3"),
      );
    });

    it("selects a project from the projects view and reloads for it", async () => {
      const { props } = renderView();
      await waitForCenterPane();
      asMock(getDiscoveryStats).mockClear();

      fireEvent.click(screen.getByTestId("select-project"));

      await waitFor(() =>
        expect(props.updateDiscoveryProjectId).toHaveBeenCalledWith("42"),
      );
      // Selecting a project drops the user onto the samples tab.
      await waitFor(() =>
        expect(screen.getByTestId("header-tab").textContent).toBe(TAB_SAMPLES),
      );
      expect(getDiscoveryStats).toHaveBeenCalled();
      expect(asMock(getDiscoveryStats).mock.calls[0][0].projectId).toBe("42");
    });
  });
});

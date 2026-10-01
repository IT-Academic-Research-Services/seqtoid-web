// "Still indexing" polling for
// app/assets/src/components/views/SamplesHeatmapView/SamplesHeatmapView.tsx
//
// When /visualizations/samples_taxons.json answers { status: "indexing" } (HTTP
// 202) the view shows a "Preparing your heatmap" state and polls. The backend
// enqueues indexing work on a normal request, so automatic retries must be
// status-only polls (indexingPoll: true), back off, never fork a second polling
// chain, stop on unmount, and after the poll budget is spent hand control to a
// "Check again" button that issues a fresh NON-poll request.
//
// Children are stubbed (as in SamplesHeatmapView-SamplesHeatmapView-branches)
// and timers are faked so the backoff schedule can be asserted exactly.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import axios from "axios";
import { getSampleTaxons } from "~/api";
import { validateSampleIds } from "~/api/access_control";
import { getSampleMetadataFields } from "~/api/metadata";
import SamplesHeatmapView from "~/components/views/SamplesHeatmapView/SamplesHeatmapView";
import { GlobalContext } from "~/globalContext/reducer";

// ------------------------------------------------------------------ API ----
jest.mock("~/api", () => ({
  __esModule: true,
  getSampleTaxons: jest.fn(),
  getTaxaDetails: jest.fn(),
  saveVisualization: jest.fn(),
}));
jest.mock("~/api/access_control", () => ({
  __esModule: true,
  validateSampleIds: jest.fn(),
}));
jest.mock("~/api/metadata", () => ({
  __esModule: true,
  getSampleMetadataFields: jest.fn(),
}));

const mockTrackEvent = jest.fn();
jest.mock("~/api/analytics", () => ({
  __esModule: true,
  useTrackEvent: () => mockTrackEvent,
  useWithAnalytics: () => (fn: $TSFixMe) => fn,
  ANALYTICS_EVENT_NAMES: {
    SAMPLES_HEATMAP_VIEW_HEATMAP_DATA_FETCHED: "heatmap_data_fetched",
    SAMPLES_HEATMAP_VIEW_LOADING_ERROR: "heatmap_loading_error",
  },
}));

jest.mock("~/components/common/UserContext", () => ({
  __esModule: true,
  useAllowedFeatures: () => [],
}));
jest.mock("~/components/utils/toast", () => ({
  __esModule: true,
  showToast: jest.fn(),
}));
jest.mock("~/components/utils/logUtil", () => ({
  __esModule: true,
  logError: jest.fn(),
}));

// -------------------------------------------------------------- children ---
const childProps: Record<string, $TSFixMe> = {};

jest.mock("~/components/common/ErrorBoundary", () => ({
  __esModule: true,
  default: ({ children }: $TSFixMe) => <>{children}</>,
}));
jest.mock("~/components/common/DetailsSidebar", () => ({
  __esModule: true,
  default: () => <div data-testid="details-sidebar" />,
}));
jest.mock("~/components/layout/FilterPanel", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="filter-panel">{props.content}</div>
  ),
}));
jest.mock("~/components/common/SampleMessage", () => ({
  __esModule: true,
  SampleMessage: (props: $TSFixMe) => (
    <div data-testid="sample-message">{props.message}</div>
  ),
}));
jest.mock("~ui/notifications/AccordionNotification", () => ({
  __esModule: true,
  default: () => <div data-testid="accordion" />,
}));
jest.mock("~ui/icons", () => ({
  __esModule: true,
  IconAlert: () => <i data-testid="icon-alert" />,
}));
jest.mock("@czi-sds/components", () => ({
  __esModule: true,
  Notification: (props: $TSFixMe) => (
    <div data-testid="notification">{props.children}</div>
  ),
  Button: ({ children, onClick }: $TSFixMe) => (
    <button onClick={onClick}>{children}</button>
  ),
}));
jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapHeader",
  () => ({
    __esModule: true,
    SamplesHeatmapHeader: () => <div data-testid="heatmap-header" />,
  }),
);
jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => {
      childProps.filters = props;
      return <div data-testid="heatmap-filters" />;
    },
  }),
);
jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapDownloadModal/SamplesHeatmapDownloadModal",
  () => ({
    __esModule: true,
    SamplesHeatmapDownloadModal: () => <div data-testid="download-modal" />,
  }),
);
jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapVis",
  () => {
    const ReactActual = jest.requireActual("react");
    class SamplesHeatmapVisStub extends ReactActual.Component {
      render() {
        return ReactActual.createElement("div", {
          "data-testid": "heatmap-vis",
        });
      }
    }
    return { __esModule: true, default: SamplesHeatmapVisStub };
  },
);

// ------------------------------------------------------------- fixtures ----
const INDEXING = { status: "indexing" };
const PREPARING_TEXT = /This page will update when it is ready/;
const EXHAUSTED_TEXT = /Your heatmap is still being prepared/;

const sample = () => ({
  sample_id: 1,
  name: "Sample A",
  host_genome_name: "Human",
  ercc_count: 10,
  pipeline_version: "6.8",
  alignment_config_name: "idx-2021",
  metadata: [],
  taxons: [
    {
      tax_id: 100,
      tax_level: 1,
      name: "Species A",
      category_name: "Bacteria",
      species_taxid: 100,
      genus_taxid: 50,
      is_phage: false,
      genus_name: "Genus A",
      NT: { rpm: 10, zscore: 2, r: 5, percentidentity: 99 },
      NR: { rpm: 4, zscore: 1, r: 2, percentidentity: 95 },
    },
  ],
});

const defaultProps = () => ({
  addedTaxonIds: [],
  backgrounds: [],
  categories: ["Bacteria"],
  heatmapTs: 1234,
  metrics: [{ text: "NT rPM", value: "NT.rpm" }],
  name: "My heatmap",
  prefilterConstants: { topN: 1000, minReads: 5 },
  removedTaxonIds: [],
  projectIds: [7],
  sampleIds: [1],
  sampleIdsToProjectIds: [],
  subcategories: {},
  taxonLevels: ["Genus", "Species"],
  thresholdFilters: { targets: [], operators: [">=", "<="] },
});

const renderView = () => {
  window.history.replaceState({}, "", "/visualizations/heatmap");
  return render(
    <GlobalContext.Provider
      value={
        {
          globalContextState: {},
          globalContextDispatch: jest.fn(),
        } as $TSFixMe
      }
    >
      <SamplesHeatmapView {...defaultProps()} />
    </GlobalContext.Provider>,
  );
};

// Drains the promise chain inside fetchViewData (validateSampleIds ->
// getSampleTaxons / metadata -> setState) without touching the fake clock.
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
};

const taxonCalls = () => (getSampleTaxons as jest.Mock).mock.calls;
const paramsOfCall = (i: number) => taxonCalls()[i][0];

// The first request plus the six automatic polls, backoff 5/10/20/40/40/40 s.
const RETRY_DELAYS_MS = [5000, 10000, 20000, 40000, 40000, 40000];

const runUntilExhausted = async () => {
  renderView();
  await settle();
  for (const delay of RETRY_DELAYS_MS) {
    await advance(delay);
  }
  expect(taxonCalls()).toHaveLength(1 + RETRY_DELAYS_MS.length);
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  for (const k of Object.keys(childProps)) delete childProps[k];
  window.onbeforeunload = null;
  (validateSampleIds as jest.Mock).mockResolvedValue({
    validIds: [1],
    invalidSampleNames: [],
  });
  (getSampleTaxons as jest.Mock).mockResolvedValue(INDEXING);
  (getSampleMetadataFields as jest.Mock).mockResolvedValue([
    { key: "collection_location_v2", name: "Location" },
  ]);
});

afterEach(() => {
  // Unmount while the fake clock is still installed so componentWillUnmount
  // clears the fake timer; otherwise a pending poll leaks into the next test.
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

// ==========================================================================
describe("SamplesHeatmapView -- heatmap indexing polls", () => {
  it("sends no indexingPoll on the first request and indexingPoll: true on the retry 5 s later", async () => {
    renderView();
    await settle();

    expect(taxonCalls()).toHaveLength(1);
    expect(paramsOfCall(0)).not.toHaveProperty("indexingPoll");
    expect(screen.getByText(PREPARING_TEXT).textContent).toMatch(
      /Preparing your heatmap/,
    );
    expect(screen.queryByText("Check again")).toBeNull();

    await advance(4999);
    expect(taxonCalls()).toHaveLength(1);

    await advance(1);
    expect(taxonCalls()).toHaveLength(2);
    expect(paramsOfCall(1)).toEqual(
      expect.objectContaining({ indexingPoll: true }),
    );
  });

  it("backs off: the second retry waits 10 s, then 20 s, then 40 s", async () => {
    renderView();
    await settle();
    await advance(5000);
    expect(taxonCalls()).toHaveLength(2);

    await advance(9999);
    expect(taxonCalls()).toHaveLength(2);
    await advance(1);
    expect(taxonCalls()).toHaveLength(3);

    await advance(19999);
    expect(taxonCalls()).toHaveLength(3);
    await advance(1);
    expect(taxonCalls()).toHaveLength(4);

    await advance(39999);
    expect(taxonCalls()).toHaveLength(4);
    await advance(1);
    expect(taxonCalls()).toHaveLength(5);

    for (let i = 1; i < taxonCalls().length; i++) {
      expect(paramsOfCall(i).indexingPoll).toBe(true);
    }
  });

  it("stops polling once the view unmounts", async () => {
    const { unmount } = renderView();
    await settle();
    expect(taxonCalls()).toHaveLength(1);

    unmount();
    await advance(5 * 60 * 1000);
    expect(taxonCalls()).toHaveLength(1);
  });

  it("does not schedule a poll when the view unmounts mid-request", async () => {
    const { unmount } = renderView();
    // Unmount before the initial request resolves; its "indexing" answer must
    // not start a polling chain on a dead component.
    unmount();
    await settle();
    await advance(5 * 60 * 1000);
    expect(taxonCalls()).toHaveLength(1);
  });

  it("stops after six automatic retries and offers Check again instead of promising an update", async () => {
    await runUntilExhausted();

    expect(screen.getByText(EXHAUSTED_TEXT)).toBeTruthy();
    expect(screen.queryByText(PREPARING_TEXT)).toBeNull();
    expect(screen.getByText("Check again")).toBeTruthy();

    await advance(10 * 60 * 1000);
    expect(taxonCalls()).toHaveLength(1 + RETRY_DELAYS_MS.length);
  });

  it("Check again issues a non-poll request and restarts the poll budget", async () => {
    await runUntilExhausted();
    const before = taxonCalls().length;

    fireEvent.click(screen.getByText("Check again"));
    await settle();

    expect(taxonCalls()).toHaveLength(before + 1);
    expect(paramsOfCall(before)).not.toHaveProperty("indexingPoll");
    expect(screen.queryByText("Check again")).toBeNull();
    expect(screen.getByText(PREPARING_TEXT)).toBeTruthy();

    // Fresh budget: the next automatic poll is back on the 5 s step.
    await advance(5000);
    expect(taxonCalls()).toHaveLength(before + 2);
    expect(paramsOfCall(before + 1).indexingPoll).toBe(true);
  });

  it("an options change cancels the pending poll, sends a non-poll request and resets the backoff", async () => {
    renderView();
    await settle();
    await advance(5000); // first poll; retries=2, next poll pending at +10 s
    expect(taxonCalls()).toHaveLength(2);

    await act(async () => {
      childProps.filters.onSelectedOptionsChange({ taxonsPerSample: 30 });
    });
    await settle();

    expect(taxonCalls()).toHaveLength(3);
    expect(paramsOfCall(2)).not.toHaveProperty("indexingPoll");
    expect(paramsOfCall(2).taxonsPerSample).toBe(30);

    // Exactly one chain, restarted on the 5 s step with the new options.
    await advance(5000);
    expect(taxonCalls()).toHaveLength(4);
    expect(paramsOfCall(3)).toEqual(
      expect.objectContaining({ indexingPoll: true, taxonsPerSample: 30 }),
    );

    // The old chain's 10 s timer must be gone: next call only at +10 s from here.
    await advance(9999);
    expect(taxonCalls()).toHaveLength(4);
    await advance(1);
    expect(taxonCalls()).toHaveLength(5);
  });

  it("a successful response clears the indexing state and stops polling", async () => {
    (getSampleTaxons as jest.Mock)
      .mockResolvedValueOnce(INDEXING)
      .mockResolvedValue([sample()]);

    renderView();
    await settle();
    expect(screen.getByText(PREPARING_TEXT)).toBeTruthy();

    await advance(5000);
    expect(taxonCalls()).toHaveLength(2);
    expect(screen.queryByText(PREPARING_TEXT)).toBeNull();
    expect(screen.getByTestId("heatmap-vis")).toBeTruthy();

    await advance(10 * 60 * 1000);
    expect(taxonCalls()).toHaveLength(2);
  });
});

// ==========================================================================
describe("getSampleTaxons -- indexingPoll reaches the query string", () => {
  it("passes indexingPoll through to axios params, serialized as indexingPoll=true", async () => {
    const { getSampleTaxons: realGetSampleTaxons } =
      jest.requireActual("~/api");
    const getSpy = jest
      .spyOn(axios, "get")
      .mockResolvedValue({ data: INDEXING } as $TSFixMe);

    await realGetSampleTaxons({ sampleIds: [1], indexingPoll: true }, null);

    expect(getSpy).toHaveBeenCalledWith(
      "/visualizations/samples_taxons.json",
      expect.objectContaining({
        params: expect.objectContaining({ indexingPoll: true }),
      }),
    );
    const [url, config] = getSpy.mock.calls[0] as $TSFixMe;
    expect(axios.getUri({ url, params: config.params })).toContain(
      "indexingPoll=true",
    );
    getSpy.mockRestore();
  });
});

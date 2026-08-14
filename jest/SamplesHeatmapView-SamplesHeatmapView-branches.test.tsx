// Branch coverage for
// app/assets/src/components/views/SamplesHeatmapView/SamplesHeatmapView.tsx
//
// SamplesHeatmapView is the controller behind /visualizations/heatmap. Almost
// none of its logic is visible in the DOM: it seeds state from the URL query
// string and from a saved-visualization blob, fans the initial load out across
// validateSampleIds / getSampleTaxons / getSampleMetadataFields, reshapes the
// raw response into the per-metric 2D arrays the vis consumes, decides which
// of six toast notifications to raise, and hands ~25 callbacks to four
// presentational children.
//
// So every child is replaced with a prop-capturing double and the callbacks
// are invoked directly -- that is the only way to reach the toggle logic
// (sidebar open vs close, pinned samples, added/removed taxa), the
// option-change fan-out (refetch vs no refetch, Z-score demotion when the
// background is cleared) and the CSV row builder's switch.
//
// SamplesHeatmapVis is stubbed as a *class* so the `ref` the view attaches
// (this.heatmapVis) resolves -- that reference is what the SVG / PNG /
// current-view-CSV download paths branch on.
import { act, render, screen, waitFor } from "@testing-library/react";
import { getSampleTaxons, getTaxaDetails, saveVisualization } from "~/api";
import { validateSampleIds } from "~/api/access_control";
import { getSampleMetadataFields } from "~/api/metadata";
import { showBulkDownloadNotification } from "~/components/common/BulkDownloadNotification";
import { createCSVObjectURL } from "~/components/utils/csv";
import { logError } from "~/components/utils/logUtil";
import { showToast } from "~/components/utils/toast";
import SamplesHeatmapView from "~/components/views/SamplesHeatmapView/SamplesHeatmapView";
import { GlobalContext } from "~/globalContext/reducer";
import { copyShortUrlToClipboard } from "~/helpers/url";

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
jest.mock("~/helpers/url", () => ({
  __esModule: true,
  copyShortUrlToClipboard: jest.fn(),
}));
jest.mock("~/components/common/BulkDownloadNotification", () => ({
  __esModule: true,
  showBulkDownloadNotification: jest.fn(),
}));
jest.mock("~/components/utils/csv", () => {
  const actual = jest.requireActual("~/components/utils/csv");
  return {
    __esModule: true,
    ...actual,
    createCSVObjectURL: jest.fn(() => "blob:heatmap-csv"),
  };
});

// -------------------------------------------------------------- children ---
const childProps: Record<string, $TSFixMe> = {};

jest.mock("~/components/common/ErrorBoundary", () => ({
  __esModule: true,
  default: ({ children }: $TSFixMe) => <>{children}</>,
}));

jest.mock("~/components/common/DetailsSidebar", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    childProps.sidebar = props;
    return <div data-testid="details-sidebar" />;
  },
}));

// FilterPanel must render `content` so the filters stub actually mounts.
jest.mock("~/components/layout/FilterPanel", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    childProps.filterPanel = props;
    return <div data-testid="filter-panel">{props.content}</div>;
  },
}));

jest.mock("~/components/common/SampleMessage", () => ({
  __esModule: true,
  SampleMessage: (props: $TSFixMe) => (
    <div data-testid="sample-message">{props.message}</div>
  ),
}));

jest.mock("~ui/notifications/AccordionNotification", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="accordion">
      {props.header}
      {props.content}
    </div>
  ),
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
}));

jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapHeader",
  () => ({
    __esModule: true,
    SamplesHeatmapHeader: (props: $TSFixMe) => {
      childProps.header = props;
      return <div data-testid="heatmap-header" />;
    },
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
    SamplesHeatmapDownloadModal: (props: $TSFixMe) => {
      childProps.downloadModal = props;
      return <div data-testid="download-modal" />;
    },
  }),
);

// Class stub so the view's `ref` callback captures an instance carrying the
// download / CSV methods.
const mockComputeCsv = jest.fn(() => [
  ["Taxon", "Genus", "Sample A"],
  [["Species A", "Genus A", "10"]],
]);
const mockDownloadSvg = jest.fn();
const mockDownloadPng = jest.fn();
jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapVis",
  () => {
    const ReactActual = jest.requireActual("react");
    class SamplesHeatmapVisStub extends ReactActual.Component {
      computeCurrentHeatmapViewValuesForCSV(...args: $TSFixMe[]) {
        return mockComputeCsv(...args);
      }
      download(...args: $TSFixMe[]) {
        return mockDownloadSvg(...args);
      }
      downloadAsPng(...args: $TSFixMe[]) {
        return mockDownloadPng(...args);
      }
      render() {
        childProps.vis = this.props;
        return ReactActual.createElement("div", {
          "data-testid": "heatmap-vis",
        });
      }
    }
    return { __esModule: true, default: SamplesHeatmapVisStub };
  },
);

// ------------------------------------------------------------- fixtures ----
const BACKGROUNDS = [
  {
    mass_normalized: false,
    name: "BG One",
    value: 26,
    alignmentConfigNames: ["idx-2021"],
  },
  {
    mass_normalized: true,
    name: "BG Two",
    value: 27,
    alignmentConfigNames: ["idx-2020"],
  },
];

const METRICS = [
  { text: "NT rPM", value: "NT.rpm" },
  { text: "NT Z Score", value: "NT.zscore" },
  { text: "NR rPM", value: "NR.rpm" },
];

const THRESHOLD_TARGETS = {
  targets: [
    { text: "NT Z Score", value: "NT_zscore" },
    { text: "NT rPM", value: "NT_rpm" },
  ],
  operators: [">=", "<="],
};

const taxon = (over: $TSFixMe = {}) => ({
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
  ...over,
});

const sample = (over: $TSFixMe = {}) => ({
  sample_id: 1,
  name: "Sample A",
  host_genome_name: "Human",
  ercc_count: 10,
  pipeline_version: "6.8",
  alignment_config_name: "idx-2021",
  metadata: [],
  taxons: [taxon()],
  ...over,
});

// Two species so a test can remove one and still have the vis rendered
// (renderHeatmap bails out to the "No taxa match the current filters" empty-state when taxonIds empties).
const twoTaxaSample = () =>
  sample({
    taxons: [
      taxon({ tax_id: 100, name: "Species A" }),
      taxon({ tax_id: 101, name: "Species B" }),
    ],
  });

const defaultProps = () => ({
  addedTaxonIds: [],
  backgrounds: BACKGROUNDS,
  categories: ["Bacteria", "Viruses"],
  heatmapTs: 1234,
  metrics: METRICS,
  name: "My heatmap",
  prefilterConstants: { topN: 1000, minReads: 5 },
  removedTaxonIds: [],
  projectIds: [7, 7, 8],
  sampleIds: [1, 2],
  sampleIdsToProjectIds: [],
  subcategories: { Viruses: ["Phage"] },
  taxonLevels: ["Genus", "Species"],
  thresholdFilters: THRESHOLD_TARGETS,
});

const mockDispatch = jest.fn();

const renderView = (props: $TSFixMe = {}, search = "") => {
  window.history.replaceState({}, "", `/visualizations/heatmap${search}`);
  return render(
    <GlobalContext.Provider
      value={
        {
          globalContextState: {},
          globalContextDispatch: mockDispatch,
        } as $TSFixMe
      }
    >
      <SamplesHeatmapView {...defaultProps()} {...props} />
    </GlobalContext.Provider>,
  );
};

const flush = async () => {
  await waitFor(() => expect(validateSampleIds).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

// Renders each toast body that was raised and returns the combined text.
const toastText = () =>
  (showToast as jest.Mock).mock.calls
    .map(([fn]: $TSFixMe) => render(fn({ closeToast: jest.fn() })).container)
    .map(c => c.textContent)
    .join(" | ");

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(childProps)) delete childProps[k];
  window.onbeforeunload = null;
  (validateSampleIds as jest.Mock).mockResolvedValue({
    validIds: [1, 2],
    invalidSampleNames: [],
  });
  (getSampleTaxons as jest.Mock).mockResolvedValue([sample()]);
  (getSampleMetadataFields as jest.Mock).mockResolvedValue([
    { key: "collection_location_v2", name: "Location" },
  ]);
  (getTaxaDetails as jest.Mock).mockResolvedValue([]);
  (saveVisualization as jest.Mock).mockResolvedValue({ id: 55 });
  window.open = jest.fn();
});

// ==========================================================================
describe("SamplesHeatmapView -- constructor / URL param seeding", () => {
  it("falls back to defaults when the URL carries no heatmap params", async () => {
    renderView();
    await flush();

    const opts = childProps.filters.selectedOptions;
    expect(opts.metric).toBe("NT.rpm");
    expect(opts.categories).toEqual([]);
    expect(opts.subcategories).toEqual({});
    expect(opts.background).toBeNull();
    expect(opts.species).toBe(1);
    expect(opts.sampleSortType).toBe("cluster");
    expect(opts.taxaSortType).toBe("cluster");
    expect(opts.thresholdFilters).toEqual([]);
    expect(opts.dataScaleIdx).toBe(0);
    expect(opts.taxonsPerSample).toBe(10);
    expect(opts.readSpecificity).toBe(1);
    expect(opts.presets).toEqual([]);
    expect(opts.taxonTags).toEqual([]);
    expect(childProps.vis.defaultMetadata).toEqual(["collection_location_v2"]);
  });

  it("parses comma-joined string params (sampleIds, taxonTags, categories, selectedMetadata)", async () => {
    renderView(
      {},
      "?sampleIds=3,4&taxonTags=knownPathogen,divergent&categories=Bacteria,Viruses" +
        "&selectedMetadata=host,water_control&metadataSortAsc=true" +
        `&subcategories=${encodeURIComponent(
          JSON.stringify({ Viruses: ["Phage"] }),
        )}`,
    );
    await flush();

    expect(validateSampleIds).toHaveBeenCalledWith(
      expect.objectContaining({ sampleIds: [3, 4] }),
    );
    const opts = childProps.filters.selectedOptions;
    expect(opts.taxonTags).toEqual(["knownPathogen", "divergent"]);
    expect(opts.categories).toEqual(["Bacteria", "Viruses"]);
    expect(opts.subcategories).toEqual({ Viruses: ["Phage"] });
    expect(childProps.vis.defaultMetadata).toEqual(["host", "water_control"]);
    expect(childProps.vis.metadataSortAsc).toBe(true);
  });

  it("treats metadataSortAsc=false as false", async () => {
    renderView({}, "?metadataSortAsc=false");
    await flush();
    expect(childProps.vis.metadataSortAsc).toBe(false);
  });

  it("parses the bracket-array form of addedTaxonIds / removedTaxonIds", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([twoTaxaSample()]);
    renderView(
      {},
      "?addedTaxonIds[]=100&addedTaxonIds[]=101&removedTaxonIds[]=100",
    );
    await flush();

    expect(Array.from(childProps.vis.selectedTaxa).sort()).toEqual([100, 101]);
    // 100 was added AND removed -- removal wins for what is displayed.
    expect(childProps.vis.taxonIds).toEqual([101]);
  });

  // NOTE: only one id per list here. The string branch parses with
  // `.split(",").map(parseInt)`, so the second element is parsed with radix 1
  // and comes back NaN -- a pre-existing bug in the source, not something this
  // suite should encode as expected behaviour.
  it("parses the comma-string form of addedTaxonIds / removedTaxonIds", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([twoTaxaSample()]);
    renderView({}, "?addedTaxonIds=100&removedTaxonIds=101");
    await flush();

    expect(Array.from(childProps.vis.selectedTaxa)).toEqual([100]);
    expect(childProps.vis.taxonIds).toEqual([100]);
  });

  it("falls back to the prop taxon ids when the URL has none", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([twoTaxaSample()]);
    renderView({ addedTaxonIds: [101], removedTaxonIds: [100] });
    await flush();

    expect(Array.from(childProps.vis.selectedTaxa)).toEqual([101]);
    expect(childProps.vis.taxonIds).toEqual([101]);
  });

  it("keeps the default for a non-numeric integer param (parseAndCheckInt NaN branch)", async () => {
    renderView(
      {},
      "?taxonsPerSample=abc&species=abc&readSpecificity=abc&dataScaleIdx=abc&background=abc",
    );
    await flush();

    const opts = childProps.filters.selectedOptions;
    expect(opts.taxonsPerSample).toBe(10);
    expect(opts.species).toBe(1);
    expect(opts.readSpecificity).toBe(1);
    expect(opts.dataScaleIdx).toBe(0);
    expect(opts.background).toBeNull();
  });

  it("uses the parsed integer when the param is numeric", async () => {
    renderView(
      {},
      "?taxonsPerSample=25&species=0&readSpecificity=0&dataScaleIdx=1&background=26",
    );
    await flush();

    const opts = childProps.filters.selectedOptions;
    expect(opts.taxonsPerSample).toBe(25);
    expect(opts.species).toBe(0);
    expect(opts.readSpecificity).toBe(0);
    expect(opts.dataScaleIdx).toBe(1);
    expect(opts.background).toBe(26);
    // species === 0 -> genus tax level and the linear scale
    expect(childProps.vis.taxLevel).toBe("genus");
    expect(childProps.vis.scale).toBe("linear");
  });

  it("uses the log scale at the default scale index", async () => {
    renderView();
    await flush();
    expect(childProps.vis.scale).toBe("symlog");
    expect(childProps.vis.taxLevel).toBe("species");
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- getSelectedMetric", () => {
  it("keeps a Z-score metric from the URL when a background is selected", async () => {
    renderView({}, "?metric=NT.zscore&background=26");
    await flush();
    expect(childProps.filters.selectedOptions.metric).toBe("NT.zscore");
  });

  it("demotes a Z-score metric to the first metric when no background is selected", async () => {
    renderView({}, "?metric=NT.zscore");
    await flush();
    expect(childProps.filters.selectedOptions.metric).toBe("NT.rpm");
  });

  it("falls back to the first metric when the URL metric is not offered by the server", async () => {
    renderView({}, "?metric=NT.bogus&background=26");
    await flush();
    expect(childProps.filters.selectedOptions.metric).toBe("NT.rpm");
  });

  it("keeps a non-Z-score URL metric that the server offers", async () => {
    renderView({}, "?metric=NR.rpm");
    await flush();
    expect(childProps.filters.selectedOptions.metric).toBe("NR.rpm");
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- threshold filters", () => {
  const zscoreThresholds = JSON.stringify([
    { metric: "NT_zscore", operator: ">=", value: "1" },
    { metric: "NT_rpm", operator: ">=", value: "5" },
  ]);

  it("drops Z-score thresholds when no background is selected", async () => {
    renderView({}, `?thresholdFilters=${encodeURIComponent(zscoreThresholds)}`);
    await flush();

    const thresholds = childProps.filters.selectedOptions.thresholdFilters;
    expect(thresholds).toHaveLength(1);
    expect(thresholds[0].metric).toBe("NT_rpm");
    // metricDisplay is back-filled from props.thresholdFilters.targets
    expect(thresholds[0].metricDisplay).toBe("NT rPM");
  });

  it("keeps Z-score thresholds when a background is selected", async () => {
    renderView(
      {},
      `?background=26&thresholdFilters=${encodeURIComponent(zscoreThresholds)}`,
    );
    await flush();

    const thresholds = childProps.filters.selectedOptions.thresholdFilters;
    expect(thresholds.map((t: $TSFixMe) => t.metric)).toEqual([
      "NT_zscore",
      "NT_rpm",
    ]);
    expect(thresholds[0].metricDisplay).toBe("NT Z Score");
  });

  it("leaves metricDisplay undefined for a threshold metric with no matching target", async () => {
    renderView(
      {},
      `?thresholdFilters=${encodeURIComponent(
        JSON.stringify([{ metric: "NR_r", operator: ">=", value: "1" }]),
      )}`,
    );
    await flush();

    expect(
      childProps.filters.selectedOptions.thresholdFilters[0].metricDisplay,
    ).toBeUndefined();
  });

  it("seeds thresholds from savedParamValues when the URL has none", async () => {
    renderView({
      savedParamValues: {
        id: 12,
        thresholdFilters: [{ metric: "NT_rpm", operator: ">=", value: "3" }],
      },
    });
    await flush();

    const thresholds = childProps.filters.selectedOptions.thresholdFilters;
    expect(thresholds).toHaveLength(1);
    expect(thresholds[0].metricDisplay).toBe("NT rPM");
    expect(childProps.header.heatmapId).toBe(12);
  });

  it("ignores savedParamValues that carry no thresholdFilters", async () => {
    renderView({ savedParamValues: { id: 13 } });
    await flush();

    expect(childProps.filters.selectedOptions.thresholdFilters).toEqual([]);
    expect(childProps.header.heatmapId).toBe(13);
  });

  it("lets URL params win over savedParamValues", async () => {
    renderView(
      {
        savedParamValues: {
          id: 14,
          thresholdFilters: [{ metric: "NT_rpm", operator: ">=", value: "3" }],
        },
      },
      `?thresholdFilters=${encodeURIComponent(
        JSON.stringify([{ metric: "NT_rpm", operator: "<=", value: "9" }]),
      )}`,
    );
    await flush();

    const thresholds = childProps.filters.selectedOptions.thresholdFilters;
    expect(thresholds[0].operator).toBe("<=");
    expect(thresholds[0].value).toBe("9");
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- onbeforeunload guard", () => {
  it("warns while the current params differ from the last saved params", async () => {
    renderView();
    await flush();

    expect(typeof window.onbeforeunload).toBe("function");
    const message = (window.onbeforeunload as $TSFixMe)();
    expect(message).toMatch(/unsaved changes/);
  });

  it("stops warning once the visualization has been saved", async () => {
    renderView();
    await flush();

    await act(async () => {
      await childProps.header.onSaveClick();
    });

    expect(saveVisualization).toHaveBeenCalledWith(
      "heatmap",
      expect.objectContaining({ metric: "NT.rpm" }),
    );
    expect(window.location.pathname).toBe("/visualizations/heatmap/55");
    expect((window.onbeforeunload as $TSFixMe)()).toBeUndefined();
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- initial load notifications", () => {
  it("does not warn when every selected sample is valid", async () => {
    renderView();
    await flush();
    expect(showToast).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ payload: [7, 8] }),
    );
  });

  it("warns about invalid samples and renders the accordion warning", async () => {
    (validateSampleIds as jest.Mock).mockResolvedValue({
      validIds: [1],
      invalidSampleNames: ["Bad One", "Bad Two"],
    });
    renderView();
    await flush();

    expect(showToast).toHaveBeenCalled();
    const text = toastText();
    expect(text).toContain("2 samples won't be included");
    expect(text).toContain("Bad One");
    expect(text).toContain("Bad Two");
  });

  it("singularizes the invalid-sample warning for exactly one sample", async () => {
    (validateSampleIds as jest.Mock).mockResolvedValue({
      validIds: [1],
      invalidSampleNames: ["Only Bad"],
    });
    renderView();
    await flush();

    expect(toastText()).toContain("1 sample won't be included");
  });

  it("warns when samples span multiple major pipeline versions", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({ pipeline_version: "6.8" }),
      sample({ sample_id: 2, name: "Sample B", pipeline_version: "7.1" }),
    ]);
    renderView();
    await flush();

    const text = toastText();
    expect(text).toContain("multiple major pipeline versions");
    expect(text).toContain("6.x, 7.x");
  });

  it("warns when samples span multiple NCBI index versions", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({ alignment_config_name: "idx-2021" }),
      sample({
        sample_id: 2,
        name: "Sample B",
        alignment_config_name: "idx-2019",
      }),
    ]);
    renderView();
    await flush();

    expect(toastText()).toContain("idx-2021, idx-2019");
  });

  it("warns when the background's index version does not match the samples'", async () => {
    // Background 27 is built on idx-2020; the sample is idx-2021.
    renderView({}, "?background=27");
    await flush();

    expect(toastText()).toContain(
      "background model you selected contains sample",
    );
  });

  it("stays quiet when the background's index version matches", async () => {
    renderView({}, "?background=26");
    await flush();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("renders the empty-data message when the server returns no samples", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([]);
    renderView();
    await flush();

    expect(
      screen.queryByText(/No taxa match the current filters/),
    ).not.toBeNull();
    expect(childProps.vis).toBeUndefined();
  });

  it("renders the empty-data message when metadata fields are unavailable", async () => {
    (getSampleMetadataFields as jest.Mock).mockResolvedValue(null);
    renderView();
    await flush();

    expect(
      screen.queryByText(/No taxa match the current filters/),
    ).not.toBeNull();
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- loading failure", () => {
  it("logs a single error and renders the error message", async () => {
    (getSampleTaxons as jest.Mock).mockRejectedValue({
      message: "boom",
      status: 500,
      statusText: "Server Error",
    });
    renderView();
    await flush();

    await waitFor(() => expect(logError).toHaveBeenCalledTimes(1));
    expect((logError as jest.Mock).mock.calls[0][0].details).toEqual(
      expect.objectContaining({
        status: 500,
        message: "boom",
        usesElasticSearch: true,
      }),
    );
    expect(screen.queryByTestId("sample-message")?.textContent).toContain(
      "Oh no! Something went wrong",
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "heatmap_loading_error",
      expect.objectContaining({ numSamples: 2 }),
    );
  });

  it("logs every error when the rejection is an array", async () => {
    (getSampleTaxons as jest.Mock).mockRejectedValue([
      { message: "one" },
      { message: "two" },
    ]);
    renderView();
    await flush();

    await waitFor(() => expect(logError).toHaveBeenCalledTimes(2));
  });

  it("falls back to the generic message when the error has no message", async () => {
    (getSampleTaxons as jest.Mock).mockRejectedValue({});
    renderView();
    await flush();

    await waitFor(() => expect(logError).toHaveBeenCalledTimes(1));
    expect((logError as jest.Mock).mock.calls[0][0].details.message).toMatch(
      /Error loading heatmap data/,
    );
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- extractData", () => {
  it("disambiguates samples that share a name", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({ sample_id: 1 }),
      sample({ sample_id: 2 }),
    ]);
    renderView();
    await flush();

    const names = Object.values(childProps.vis.sampleDetails).map(
      (d: $TSFixMe) => d.name,
    );
    expect(names).toEqual(["Sample A", "Sample A (1)"]);
  });

  it("splits taxa into species and genus buckets", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({
        taxons: [
          taxon({ tax_id: 100, tax_level: 1 }),
          taxon({ tax_id: 50, tax_level: 2, name: "Genus A" }),
        ],
      }),
    ]);
    renderView();
    await flush();

    // species mode is the default, so allTaxonIds hands over the species ids
    expect(childProps.vis.allTaxonIds).toEqual([100]);
    expect(childProps.vis.taxonDetails[50].taxLevel).toBe(2);
  });

  it("counts a taxon seen in two samples once, with sampleCount 2", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({ sample_id: 1 }),
      sample({ sample_id: 2, name: "Sample B" }),
    ]);
    renderView();
    await flush();

    expect(childProps.vis.taxonDetails[100].sampleCount).toBe(2);
    expect(childProps.vis.taxonIds).toEqual([100]);
  });

  it("tolerates a sample with no taxons at all", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({ taxons: undefined }),
    ]);
    renderView();
    await flush();

    expect(
      screen.queryByText(/No taxa match the current filters/),
    ).not.toBeNull();
  });

  it("disables mass-normalized backgrounds when a sample has no ERCC reads", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({ ercc_count: 0 }),
    ]);
    renderView();
    await flush();

    expect(childProps.filters.enableMassNormalizedBackgrounds).toBe(false);
  });

  it("enables mass-normalized backgrounds when ERCC reads and pipeline version allow it", async () => {
    renderView();
    await flush();
    expect(childProps.filters.enableMassNormalizedBackgrounds).toBe(true);
  });

  it("disables mass-normalized backgrounds on an old pipeline version", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({ pipeline_version: "3.1" }),
    ]);
    renderView();
    await flush();

    expect(childProps.filters.enableMassNormalizedBackgrounds).toBe(false);
  });

  it("records a falsy parentId when the taxon is not its own species", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({ taxons: [taxon({ tax_id: 100, species_taxid: 999 })] }),
    ]);
    renderView();
    await flush();

    expect(childProps.vis.taxonDetails[100].parentId).toBe(false);
  });

  it("records the genus as parentId for a taxon that is its own species", async () => {
    renderView();
    await flush();
    expect(childProps.vis.taxonDetails[100].parentId).toBe(50);
  });

  it("flags phage taxa", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({ taxons: [taxon({ is_phage: 1 })] }),
    ]);
    renderView();
    await flush();

    expect(childProps.vis.taxonDetails[100].phage).toBe(true);
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- threshold filter state", () => {
  const withThreshold = (metric: string, operator: string, value: string) =>
    `?thresholdFilters=${encodeURIComponent(
      JSON.stringify([{ metric, operator, value }]),
    )}`;

  it("greys out a taxon whose metric is below a >= threshold", async () => {
    renderView({}, withThreshold("NT_rpm", ">=", "500"));
    await flush();
    expect(childProps.vis.taxonFilterState[0][0]).toBe(false);
  });

  it("keeps a taxon whose metric clears a >= threshold", async () => {
    renderView({}, withThreshold("NT_rpm", ">=", "5"));
    await flush();
    expect(childProps.vis.taxonFilterState[0][0]).toBe(true);
  });

  it("greys out a taxon whose metric exceeds a <= threshold", async () => {
    renderView({}, withThreshold("NT_rpm", "<=", "1"));
    await flush();
    expect(childProps.vis.taxonFilterState[0][0]).toBe(false);
  });

  it("keeps a taxon whose metric is under a <= threshold", async () => {
    renderView({}, withThreshold("NT_rpm", "<=", "50"));
    await flush();
    expect(childProps.vis.taxonFilterState[0][0]).toBe(true);
  });

  it("greys out a taxon whose metric value is zero", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({
        taxons: [taxon({ NT: { rpm: 0, zscore: 0, r: 0 } })],
      }),
    ]);
    renderView({}, withThreshold("NT_rpm", ">=", "1"));
    await flush();

    expect(childProps.vis.taxonFilterState[0][0]).toBe(false);
  });

  it("ignores a threshold whose metric was never fetched", async () => {
    renderView({}, withThreshold("NT_percentidentity", ">=", "99"));
    await flush();
    expect(childProps.vis.taxonFilterState[0][0]).toBe(true);
  });

  it("marks every taxon as passing when there are no thresholds", async () => {
    renderView();
    await flush();
    expect(childProps.vis.taxonFilterState[0][0]).toBe(true);
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- header actions", () => {
  it("opens and closes the download modal", async () => {
    renderView();
    await flush();

    expect(screen.queryByTestId("download-modal")).toBeNull();
    act(() => childProps.header.onDownloadClick());
    expect(screen.queryByTestId("download-modal")).not.toBeNull();

    act(() => childProps.downloadModal.onClose());
    expect(screen.queryByTestId("download-modal")).toBeNull();
  });

  it("closes the download modal and notifies after a bulk download is generated", async () => {
    renderView();
    await flush();

    act(() => childProps.header.onDownloadClick());
    act(() => childProps.downloadModal.onGenerateBulkDownload());

    expect(showBulkDownloadNotification).toHaveBeenCalled();
    expect(screen.queryByTestId("download-modal")).toBeNull();
  });

  it("copies a short url when sharing", async () => {
    renderView();
    await flush();

    await act(async () => {
      await childProps.header.onShareClick();
    });
    expect(copyShortUrlToClipboard).toHaveBeenCalledWith(
      expect.stringContaining("/visualizations/heatmap?"),
    );
  });

  it("toggles the filter panel", async () => {
    renderView();
    await flush();

    expect(childProps.header.filterPanelOpen).toBe(true);
    expect(childProps.vis.fullScreen).toBe(false);

    act(() => childProps.header.onFilterToggleClick());
    expect(childProps.header.filterPanelOpen).toBe(false);
    expect(childProps.vis.fullScreen).toBe(true);

    act(() => childProps.header.onFilterToggleClick());
    expect(childProps.header.filterPanelOpen).toBe(true);
    expect(childProps.vis.fullScreen).toBe(false);
  });

  it("keeps rendering after the new-presets click", async () => {
    renderView();
    await flush();
    act(() => childProps.header.onNewPresetsClick());
    expect(screen.queryByTestId("heatmap-header")).not.toBeNull();
    expect(screen.queryByTestId("heatmap-vis")).not.toBeNull();
  });

  it("has no heatmapId when the view was never saved", async () => {
    renderView();
    await flush();
    expect(childProps.header.heatmapId).toBeUndefined();
    expect(childProps.header.heatmapName).toBe("My heatmap");
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- downloads", () => {
  it("opens the all-metrics CSV endpoint with filters stripped", async () => {
    renderView({}, "?background=26&readSpecificity=0");
    await flush();
    act(() => childProps.header.onDownloadClick());

    act(() => childProps.downloadModal.onDownloadAllHeatmapMetricsCsv());
    const [href, target] = (window.open as jest.Mock).mock.calls[0];
    expect(href).toContain("/visualizations/download_heatmap?");
    expect(href).not.toContain("readSpecificity");
    expect(href).toContain("background=26");
    expect(target).toBe("_blank");
  });

  it("delegates SVG and PNG downloads to the vis instance", async () => {
    renderView();
    await flush();
    act(() => childProps.header.onDownloadClick());

    act(() => childProps.downloadModal.onDownloadSvg());
    act(() => childProps.downloadModal.onDownloadPng());
    expect(mockDownloadSvg).toHaveBeenCalled();
    expect(mockDownloadPng).toHaveBeenCalled();
  });

  it("builds the current-view CSV from the rendered vis", async () => {
    renderView();
    await flush();
    act(() => childProps.header.onDownloadClick());

    const url = childProps.downloadModal.onDownloadCurrentHeatmapViewCsv();
    expect(url).toBe("blob:heatmap-csv");
    expect(mockComputeCsv).toHaveBeenCalledWith({
      headers: ["Taxon", "Genus"],
    });
    const [headers, rows] = (createCSVObjectURL as jest.Mock).mock.calls[0];
    expect(headers).toEqual(["Taxon", "Genus", "Sample A"]);
    expect(rows[rows.length - 1]).toEqual([
      "NA: Not Applicable; sample did not meet thresholds set",
    ]);
  });

  it("omits the Genus header in genus mode", async () => {
    renderView({}, "?species=0");
    await flush();
    act(() => childProps.header.onDownloadClick());
    childProps.downloadModal.onDownloadCurrentHeatmapViewCsv();

    expect(mockComputeCsv).toHaveBeenCalledWith({ headers: ["Taxon"] });
  });

  it("emits a placeholder CSV when the heatmap never rendered", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([]);
    renderView();
    await flush();
    act(() => childProps.header.onDownloadClick());

    childProps.downloadModal.onDownloadCurrentHeatmapViewCsv();
    const [headers] = (createCSVObjectURL as jest.Mock).mock.calls[0];
    expect(headers).toEqual(['"Current heatmap view did not render any data"']);
    expect(mockComputeCsv).not.toHaveBeenCalled();
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- CSV applied-filters row", () => {
  const filterRow = () => {
    const rows = (createCSVObjectURL as jest.Mock).mock.calls[0][1];
    return rows[rows.length - 2][0];
  };

  const downloadCsv = () => {
    act(() => childProps.header.onDownloadClick());
    childProps.downloadModal.onDownloadCurrentHeatmapViewCsv();
  };

  it("reports 'No Filters Applied.' and the None background by default", async () => {
    renderView();
    await flush();
    downloadCsv();

    expect(filterRow()).toContain("No Filters Applied.");
    expect(filterRow()).toContain("None");
    expect(filterRow()).toContain("NT.rpm");
  });

  it("names the selected background", async () => {
    renderView({}, "?background=27");
    await flush();
    downloadCsv();
    expect(filterRow()).toContain("BG Two");
  });

  it("singularizes a single applied filter", async () => {
    renderView({}, "?readSpecificity=0");
    await flush();
    downloadCsv();

    expect(filterRow()).toContain("1 Filter Applied:");
    expect(filterRow()).toContain("Read Specificity");
    expect(filterRow()).toContain("All");
  });

  it("counts categories, subcategories, thresholds and tags together", async () => {
    renderView(
      {},
      "?categories=Bacteria,Viruses" +
        `&subcategories=${encodeURIComponent(
          JSON.stringify({ Viruses: ["Phage"], Bacteria: [] }),
        )}` +
        "&taxonTags=knownPathogen" +
        `&thresholdFilters=${encodeURIComponent(
          JSON.stringify([{ metric: "NT_rpm", operator: ">=", value: "1" }]),
        )}`,
    );
    await flush();
    downloadCsv();

    const row = filterRow();
    expect(row).toMatch(/\d+ Filters Applied:/);
    expect(row).toContain("Categories:");
    expect(row).toContain("Viruses - Phage");
    expect(row).toContain("Pathogen Tags");
    expect(row).toContain("Thresholds:");
    expect(row).toContain("NT rPM >= 1");
  });

  it("logs an error for an applied filter it does not know how to render", async () => {
    // `metric` is not in the omit list of getAppliedFilters, so changing it
    // away from the default drops it into the switch's default case.
    renderView({}, "?metric=NR.rpm");
    await flush();
    downloadCsv();

    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { name: "metric", val: "NR.rpm" },
      }),
    );
    expect(filterRow()).toContain("No Filters Applied.");
  });

  it("skips an applied filter whose value is undefined", async () => {
    // With no server metrics, getSelectedMetric yields undefined, so the diff
    // carries `metric: undefined` and the loop must skip it rather than fall
    // into the default case's "Invalid filter" log.
    renderView({ metrics: [] });
    await flush();
    downloadCsv();

    const loggedMessages = (logError as jest.Mock).mock.calls.map(
      ([arg]: $TSFixMe) => arg.message,
    );
    expect(loggedMessages).not.toContain(
      "SamplesHeatmapView: Invalid filter passed to createCSVRowForSelectedOptions()",
    );
    expect(filterRow()).toContain("No Filters Applied.");
    expect(filterRow()).toContain("Metric:");
  });

  it("skips an empty threshold list", async () => {
    renderView(
      {},
      `?thresholdFilters=${encodeURIComponent(
        JSON.stringify([]),
      )}&readSpecificity=0`,
    );
    await flush();
    downloadCsv();

    expect(filterRow()).not.toContain("Thresholds:");
    expect(filterRow()).toContain("1 Filter Applied:");
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- selected option changes", () => {
  it("ignores a null option payload", async () => {
    renderView();
    await flush();
    (getSampleTaxons as jest.Mock).mockClear();

    act(() => childProps.filters.onSelectedOptionsChange(null));
    expect(getSampleTaxons).not.toHaveBeenCalled();
  });

  it("ignores an option payload identical to current state", async () => {
    renderView();
    await flush();
    (getSampleTaxons as jest.Mock).mockClear();

    act(() => childProps.filters.onSelectedOptionsChange({ species: 1 }));
    expect(getSampleTaxons).not.toHaveBeenCalled();
  });

  it("refetches when a backend filter changes", async () => {
    renderView();
    await flush();
    (getSampleTaxons as jest.Mock).mockClear();

    await act(async () => {
      childProps.filters.onSelectedOptionsChange({ taxonsPerSample: 30 });
    });
    await waitFor(() => expect(getSampleTaxons).toHaveBeenCalled());
    expect(getSampleTaxons).toHaveBeenCalledWith(
      expect.objectContaining({ taxonsPerSample: 30 }),
      expect.anything(),
    );
  });

  it("does not re-request the metadata fields on a refetch", async () => {
    renderView();
    await flush();
    (getSampleMetadataFields as jest.Mock).mockClear();

    await act(async () => {
      childProps.filters.onSelectedOptionsChange({ taxonsPerSample: 30 });
    });
    await waitFor(() => expect(getSampleTaxons).toHaveBeenCalled());
    expect(getSampleMetadataFields).not.toHaveBeenCalled();
  });

  it("does not refetch for a client-side-only option", async () => {
    renderView();
    await flush();
    (getSampleTaxons as jest.Mock).mockClear();

    await act(async () => {
      childProps.filters.onSelectedOptionsChange({ sampleSortType: "alpha" });
    });
    expect(getSampleTaxons).not.toHaveBeenCalled();
    expect(childProps.filters.selectedOptions.sampleSortType).toBe("alpha");
  });

  it("raises the slow-custom-background toast when a background is picked", async () => {
    renderView();
    await flush();
    (showToast as jest.Mock).mockClear();

    await act(async () => {
      childProps.filters.onSelectedOptionsChange({ background: 26 });
    });
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(toastText()).toContain("new background model");
  });

  it("clears the background, drops Z-score thresholds and demotes a Z-score metric", async () => {
    renderView(
      {},
      "?background=26&metric=NT.zscore" +
        `&thresholdFilters=${encodeURIComponent(
          JSON.stringify([
            { metric: "NT_zscore", operator: ">=", value: "1" },
            { metric: "NT_rpm", operator: ">=", value: "2" },
          ]),
        )}`,
    );
    await flush();
    expect(childProps.filters.selectedOptions.metric).toBe("NT.zscore");

    await act(async () => {
      childProps.filters.onSelectedOptionsChange({ background: 0 });
    });

    const opts = childProps.filters.selectedOptions;
    expect(opts.background).toBeNull();
    expect(opts.metric).toBe("NT.rpm");
    expect(opts.thresholdFilters.map((t: $TSFixMe) => t.metric)).toEqual([
      "NT_rpm",
    ]);
  });

  it("keeps a non-Z-score metric when the background is cleared", async () => {
    renderView({}, "?background=26&metric=NR.rpm");
    await flush();

    await act(async () => {
      childProps.filters.onSelectedOptionsChange({ background: 0 });
    });
    expect(childProps.filters.selectedOptions.metric).toBe("NR.rpm");
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- sidebar", () => {
  it("opens the sample sidebar, toggles it shut on the same sample and reopens on another", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({ sample_id: 1 }),
      sample({ sample_id: 2, name: "Sample B" }),
    ]);
    renderView();
    await flush();

    expect(childProps.sidebar.visible).toBe(false);
    expect(childProps.sidebar.params).toEqual({});

    act(() => childProps.vis.onSampleLabelClick(1));
    expect(childProps.sidebar.visible).toBe(true);
    expect(childProps.sidebar.mode).toBe("sampleDetails");
    expect(childProps.sidebar.params.sampleId).toBe(1);
    expect(childProps.sidebar.params.showReportLink).toBe(true);

    act(() => childProps.vis.onSampleLabelClick(1));
    expect(childProps.sidebar.visible).toBe(false);

    act(() => childProps.vis.onSampleLabelClick(2));
    expect(childProps.sidebar.visible).toBe(true);
    expect(childProps.sidebar.params.sampleId).toBe(2);
  });

  it("closes the sidebar when the sample label click carries no id", async () => {
    renderView();
    await flush();

    act(() => childProps.vis.onSampleLabelClick(1));
    expect(childProps.sidebar.visible).toBe(true);
    act(() => childProps.vis.onSampleLabelClick(null));
    expect(childProps.sidebar.visible).toBe(false);
  });

  it("opens the taxon sidebar, toggles it shut and switches taxa", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([twoTaxaSample()]);
    renderView();
    await flush();

    act(() => childProps.vis.onTaxonLabelClick("Species A"));
    expect(childProps.sidebar.mode).toBe("taxonDetails");
    expect(childProps.sidebar.visible).toBe(true);
    expect(childProps.sidebar.params).toEqual(
      expect.objectContaining({ taxonId: 100, taxonName: "Species A" }),
    );

    act(() => childProps.vis.onTaxonLabelClick("Species A"));
    expect(childProps.sidebar.visible).toBe(false);

    act(() => childProps.vis.onTaxonLabelClick("Species B"));
    expect(childProps.sidebar.visible).toBe(true);
    expect(childProps.sidebar.params.taxonId).toBe(101);
  });

  it("closes the sidebar for an unknown taxon name", async () => {
    renderView();
    await flush();

    act(() => childProps.vis.onTaxonLabelClick("Species A"));
    expect(childProps.sidebar.visible).toBe(true);
    act(() => childProps.vis.onTaxonLabelClick("Nope"));
    expect(childProps.sidebar.visible).toBe(false);
  });

  it("closes the sidebar via its own close handler", async () => {
    renderView();
    await flush();

    act(() => childProps.vis.onSampleLabelClick(1));
    act(() => childProps.sidebar.onClose());
    expect(childProps.sidebar.visible).toBe(false);
  });

  it("writes metadata updates back into sampleDetails", async () => {
    renderView();
    await flush();

    act(() => childProps.vis.onSampleLabelClick(1));
    act(() => childProps.sidebar.params.onMetadataUpdate("host", "Mosquito"));
    expect(childProps.vis.sampleDetails[1].metadata.host).toBe("Mosquito");
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- taxa and sample pinning", () => {
  it("removes a taxon that was manually added", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([twoTaxaSample()]);
    renderView({}, "?addedTaxonIds=100");
    await flush();

    expect(Array.from(childProps.vis.selectedTaxa)).toEqual([100]);
    act(() => childProps.vis.onRemoveTaxon("Species A"));
    expect(Array.from(childProps.vis.selectedTaxa)).toEqual([]);
    expect(childProps.vis.taxonIds).toEqual([101]);
  });

  it("removes a taxon that was never manually added", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([twoTaxaSample()]);
    renderView();
    await flush();

    expect(childProps.vis.taxonIds).toEqual([100, 101]);
    act(() => childProps.vis.onRemoveTaxon("Species A"));
    expect(childProps.vis.taxonIds).toEqual([101]);
  });

  it("un-removes a taxon that is selected again", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([twoTaxaSample()]);
    renderView();
    await flush();

    act(() => childProps.vis.onRemoveTaxon("Species A"));
    expect(childProps.vis.taxonIds).toEqual([101]);

    await act(async () => {
      childProps.vis.onAddTaxon([100, 101]);
    });
    expect(childProps.vis.taxonIds.sort()).toEqual([100, 101]);
    expect(getTaxaDetails).not.toHaveBeenCalled();
  });

  it("fetches details for a newly added taxon the server never sent", async () => {
    (getTaxaDetails as jest.Mock).mockResolvedValue([
      sample({ taxons: [taxon({ tax_id: 777, name: "Species Z" })] }),
    ]);
    renderView();
    await flush();

    await act(async () => {
      childProps.vis.onAddTaxon([100, 777]);
    });
    await waitFor(() => expect(getTaxaDetails).toHaveBeenCalled());
    expect(getTaxaDetails).toHaveBeenCalledWith(
      expect.objectContaining({ taxonIds: [777], updateBackgroundOnly: false }),
    );
  });

  it("pins, applies, cancels and unpins samples", async () => {
    renderView();
    await flush();

    act(() => childProps.vis.onPinSample(null, [{ id: 1 }, 2]));
    expect(childProps.vis.pendingPinnedSampleIds).toEqual([1, 2]);
    expect(childProps.vis.pinnedSampleIds).toEqual([]);

    act(() => childProps.vis.onPinSampleApply());
    expect(childProps.vis.pinnedSampleIds).toEqual([1, 2]);

    act(() => childProps.vis.onPinSample(null, [3]));
    act(() => childProps.vis.onPinSampleCancel());
    expect(childProps.vis.pendingPinnedSampleIds).toEqual([1, 2]);

    act(() => childProps.vis.onUnpinSample(1));
    expect(childProps.vis.pinnedSampleIds).toEqual([2]);
  });

  it("records the selected metadata columns", async () => {
    renderView();
    await flush();

    act(() => childProps.vis.onMetadataChange(new Set(["host"])));
    expect(childProps.vis.defaultMetadata).toEqual(["host"]);
  });

  it("records the metadata sort field and direction", async () => {
    renderView();
    await flush();

    // onMetadataSortChange writes to instance fields, so force a re-render to
    // observe what the vis is handed next.
    act(() => childProps.vis.onMetadataSortChange("host", false));
    act(() => childProps.header.onFilterToggleClick());

    expect(childProps.vis.metadataSortField).toBe("host");
    expect(childProps.vis.metadataSortAsc).toBe(false);
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- control options passed to children", () => {
  it("filters server metrics down to the supported list and indexes taxon levels", async () => {
    renderView({
      metrics: [...METRICS, { text: "NT %id", value: "NT.percentidentity" }],
    });
    await flush();

    const options = childProps.filters.options;
    expect(options.metrics.map((m: $TSFixMe) => m.value)).toEqual([
      "NT.rpm",
      "NT.zscore",
      "NR.rpm",
    ]);
    expect(options.taxonLevels).toEqual([
      { text: "Genus", value: 0 },
      { text: "Species", value: 1 },
    ]);
    expect(options.backgrounds).toBe(BACKGROUNDS);
    expect(options.specificityOptions).toHaveLength(2);
    expect(options.scales).toEqual([
      ["Log", "symlog"],
      ["Lin", "linear"],
    ]);
  });

  it("falls back to empty categories and subcategories when the server sends none", async () => {
    renderView({ categories: undefined, subcategories: undefined });
    await flush();

    expect(childProps.filters.options.categories).toEqual([]);
    expect(childProps.filters.options.subcategories).toEqual({});
  });

  it("counts total taxa from the species bucket in species mode", async () => {
    renderView();
    await flush();
    expect(childProps.filters.totalTaxaCount).toBe(1);
    expect(childProps.filters.filteredTaxaCount).toBe(1);
  });

  it("counts total taxa from the genus bucket in genus mode", async () => {
    (getSampleTaxons as jest.Mock).mockResolvedValue([
      sample({
        taxons: [
          taxon({ tax_id: 50, tax_level: 2, name: "Genus A" }),
          taxon({ tax_id: 100, tax_level: 1 }),
        ],
      }),
    ]);
    renderView({}, "?species=0");
    await flush();

    expect(childProps.filters.totalTaxaCount).toBe(1);
  });
});

// ==========================================================================
describe("SamplesHeatmapView -- background name caption", () => {
  it("passes the None background name when nothing is selected", async () => {
    renderView();
    await flush();
    expect(childProps.vis.backgroundName).toBe("None");
  });

  it("passes the selected background's name", async () => {
    renderView({}, "?background=26");
    await flush();
    expect(childProps.vis.backgroundName).toBe("BG One");
  });
});

// Coverage: app/assets/src/components/views/SamplesHeatmapView/components/
//   SamplesHeatmapVis/SamplesHeatmapVis.tsx
//
// SamplesHeatmapVis is the React shell around the imperative D3 Heatmap class:
// it maps props into Heatmap constructor data/options, forwards prop changes
// into imperative update* calls, owns all hover/click state that drives the
// tooltips and selector popovers, and builds the printed caption strings.
//
// The D3 Heatmap, d3 itself and every popover/selector child are stubbed so the
// tests can assert on the exact payloads this file computes. The component is
// rendered with a ref so its handlers (which the real Heatmap would invoke via
// callbacks) can be driven directly.
import { act, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------- mocks

const mockHeatmapInstances: $TSFixMe[] = [];
let mockHeatmapCtorArgs: $TSFixMe[] = [];

jest.mock("~/components/visualizations/heatmap/Heatmap", () => {
  return {
    __esModule: true,
    default: class FakeHeatmap {
      options: $TSFixMe;
      data: $TSFixMe;
      constructor(container: $TSFixMe, data: $TSFixMe, options: $TSFixMe) {
        mockHeatmapCtorArgs = [container, data, options];
        this.data = data;
        this.options = { ...options, zoom: 1 };
        mockHeatmapInstances.push(this);
      }
      start = jest.fn();
      updateScale = jest.fn();
      updateData = jest.fn();
      updatePrintCaption = jest.fn();
      updateSortColumns = jest.fn();
      updateSortRows = jest.fn();
      updateColumnMetadata = jest.fn();
      updateZoom = jest.fn();
      scrollToRow = jest.fn();
      scroll = jest.fn();
      download = jest.fn();
      downloadAsPng = jest.fn();
      computeCurrentHeatmapViewValuesForCSV = jest.fn(() => ["csv"]);
      getCursorLocation = jest.fn(() => ({ left: 40, top: 60 }));
      getColumnMetadataLegend = jest.fn(() => ({
        SF: "#111111",
        Unknown: "#222222",
      }));
    },
  };
});

// Only d3.select(...).on() (wheel binding) and d3.event (scroll) are used here.
jest.mock("d3", () => ({
  __esModule: true,
  default: {
    select: jest.fn(() => ({ on: jest.fn() })),
    event: null,
  },
}));

const mockLogError = jest.fn();
jest.mock("~/components/utils/logUtil", () => ({
  logError: (...args: $TSFixMe[]) => mockLogError(...args),
}));

const mockOpenUrlInNewTab = jest.fn();
jest.mock("~utils/links", () => ({
  openUrlInNewTab: (...args: $TSFixMe[]) => mockOpenUrlInNewTab(...args),
}));

jest.mock("~/components/utils/urls", () => ({
  generateUrlToSampleView: (opts: $TSFixMe) => `/samples/${opts.sampleId}`,
}));

jest.mock("~/components/common/Heatmap/MetadataLegend", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    const ReactLib = require("react");
    return ReactLib.createElement("div", {
      "data-testid": "metadata-legend",
      "data-colors": JSON.stringify(props.metadataColors),
    });
  },
}));
jest.mock("~/components/common/Heatmap/RowGroupLegend", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    const ReactLib = require("react");
    return ReactLib.createElement(
      "div",
      { "data-testid": "row-group-legend" },
      props.label,
    );
  },
}));
jest.mock("~/components/common/Heatmap/MetadataSelector", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    const ReactLib = require("react");
    return ReactLib.createElement(
      "div",
      { "data-testid": "metadata-selector" },
      ReactLib.createElement("button", {
        "data-testid": "metadata-selector-close",
        onClick: props.onMetadataSelectionClose,
      }),
      JSON.stringify(props.metadataTypes),
    );
  },
}));
jest.mock("~/components/common/Heatmap/PinSampleSelector", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    const ReactLib = require("react");
    return ReactLib.createElement(
      "div",
      { "data-testid": "pin-sample-selector" },
      ReactLib.createElement("button", {
        "data-testid": "pin-sample-close",
        onClick: props.onClose,
      }),
      JSON.stringify(props.options),
    );
  },
}));
jest.mock("~/components/common/TaxonSelector", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    const ReactLib = require("react");
    return ReactLib.createElement(
      "div",
      { "data-testid": "taxon-selector" },
      ReactLib.createElement("button", {
        "data-testid": "taxon-selector-apply",
        onClick: () => props.onTaxonSelectionChange([999]),
      }),
      ReactLib.createElement("button", {
        "data-testid": "taxon-selector-close",
        onClick: props.onTaxonSelectionClose,
      }),
      JSON.stringify(props.availableTaxa),
    );
  },
}));
jest.mock("~/components/common/BasicPopup", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    const ReactLib = require("react");
    return ReactLib.createElement("div", {
      "data-testid": "basic-popup",
      "data-content": props.content,
    });
  },
}));
jest.mock("~/components/ui/controls/PlusMinusControl", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    const ReactLib = require("react");
    return ReactLib.createElement(
      "div",
      null,
      ReactLib.createElement("button", {
        "data-testid": "zoom-plus",
        onClick: props.onPlusClick,
      }),
      ReactLib.createElement("button", {
        "data-testid": "zoom-minus",
        onClick: props.onMinusClick,
      }),
    );
  },
}));
jest.mock("~ui/containers", () => ({
  TooltipVizTable: (props: $TSFixMe) => {
    const ReactLib = require("react");
    return ReactLib.createElement("div", {
      "data-testid": "tooltip-viz-table",
      "data-sections": JSON.stringify(
        (props.data || []).map((s: $TSFixMe) => s.name),
      ),
    });
  },
}));
jest.mock("~ui/icons", () => {
  const ReactLib = require("react");
  return {
    IconAlertSmall: () =>
      ReactLib.createElement("span", { "data-testid": "icon-alert" }),
    IconCloseSmall: (props: $TSFixMe) =>
      ReactLib.createElement("span", {
        "data-testid": "icon-close",
        onClick: props.onClick,
      }),
  };
});
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    Tooltip: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "sds-tooltip", "data-title": props.title },
        props.children,
      ),
    ButtonIcon: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "toggle-names",
        "data-on": String(!!props.on),
        disabled: props.disabled,
        onClick: props.onClick,
      }),
  };
});

import mockD3 from "d3";
import { UserContext } from "~/components/common/UserContext";
import { SamplesHeatmapVis } from "~/components/views/SamplesHeatmapView/components/SamplesHeatmapVis/SamplesHeatmapVis";

// ---------------------------------------------------------------- fixtures

const DATA = {
  "NT.zscore": [
    [1.234567, 2],
    [0, 0],
  ],
  "NT.rpm": [
    [10, 20],
    [0, 0],
  ],
  "NT.r": [
    [100, 200],
    [0, 0],
  ],
  "NR.zscore": [
    [null, 1],
    [0, 0],
  ],
  "NR.rpm": [
    [5, 6],
    [0, 0],
  ],
  "NR.r": [
    [7, 8],
    [0, 0],
  ],
};

const SAMPLE_DETAILS = {
  1: {
    name: "Sample One With A Really Long Name",
    metadata: { collection_location: "SF" },
    duplicate: false,
    index: 0,
  },
  2: { name: "S2", metadata: {}, duplicate: true, index: 1 },
};

const TAXON_DETAILS = {
  100: {
    name: "Taxon A",
    parentId: -200,
    genusName: "Genus A",
    index: 0,
    category: "Bacteria",
    sampleCount: 2,
  },
  200: {
    name: "Taxon B",
    parentId: 55,
    genusName: null,
    index: 1,
    category: "Viruses",
    sampleCount: 1,
  },
};

// taxonFilterState[taxonIndex][sampleIndex]
const TAXON_FILTER_STATE = {
  0: { 0: true, 1: false },
  1: { 0: false, 1: false },
};

const APPLIED_FILTERS = {
  categories: ["Bacteria"],
  subcategories: { Viruses: ["Phage"] },
  readSpecificity: 1,
  taxonTags: ["known_pathogen"],
  thresholdFilters: [{ metricDisplay: "NT rPM", operator: ">=", value: "10" }],
};

function baseProps(overrides: $TSFixMe = {}) {
  return {
    data: DATA,
    taxonFilterState: TAXON_FILTER_STATE,
    defaultMetadata: ["collection_location"],
    metadataTypes: [
      { key: "collection_location", name: "Location" },
      { key: "", name: "No Key" },
    ],
    metric: "NT.rpm",
    metadataSortField: "collection_location",
    metadataSortAsc: true,
    options: { scales: [["Log", "symlog"]] },
    sampleDetails: SAMPLE_DETAILS,
    sampleIds: [1, 2],
    selectedOptions: { metric: "NT.rpm", taxonsPerSample: 10 },
    scale: "symlog",
    taxLevel: "species",
    taxonDetails: TAXON_DETAILS,
    allTaxonIds: [100, 200],
    taxonIds: [100, 200],
    pinnedSampleIds: [2],
    pendingPinnedSampleIds: [],
    appliedFilters: APPLIED_FILTERS,
    backgroundName: "NID Human CSF",
    sampleSortType: "alpha",
    taxaSortType: "genus",
    ...overrides,
  };
}

function renderVis(overrides: $TSFixMe = {}, allowedFeatures: string[] = []) {
  const ref = { current: null as $TSFixMe };
  const props = baseProps(overrides);
  const utils = render(
    <UserContext.Provider value={{ allowedFeatures } as $TSFixMe}>
      <SamplesHeatmapVis ref={ref} {...(props as $TSFixMe)} />
    </UserContext.Provider>,
  );
  const rerenderWith = (next: $TSFixMe) =>
    utils.rerender(
      <UserContext.Provider value={{ allowedFeatures } as $TSFixMe}>
        <SamplesHeatmapVis ref={ref} {...(baseProps(next) as $TSFixMe)} />
      </UserContext.Provider>,
    );
  return { ref, rerenderWith, ...utils };
}

const heatmap = () => mockHeatmapInstances[mockHeatmapInstances.length - 1];
const ctorOptions = () => mockHeatmapCtorArgs[2];
const ctorData = () => mockHeatmapCtorArgs[1];

beforeEach(() => {
  mockHeatmapInstances.length = 0;
  mockHeatmapCtorArgs = [];
  mockLogError.mockClear();
  mockOpenUrlInNewTab.mockClear();
  mockD3.event = null;
});

// ---------------------------------------------------------------- tests

describe("SamplesHeatmapVis mount", () => {
  it("constructs and starts the Heatmap with mapped labels and values", () => {
    renderVis();
    expect(mockHeatmapInstances).toHaveLength(1);
    expect(heatmap().start).toHaveBeenCalled();
    expect(ctorData().values).toBe(DATA["NT.rpm"]);
    expect(ctorData().taxonFilterState).toBe(TAXON_FILTER_STATE);
    expect(ctorOptions().shouldSortColumns).toBe(true);
    expect(ctorOptions().shouldSortRows).toBe(true);
    expect(ctorOptions().scaleMin).toBe(0);
  });

  it("truncates long sample labels but keeps the full print label", () => {
    renderVis();
    const columns = ctorData().columnLabels;
    expect(columns[0].printLabel).toBe("Sample One With A Really Long Name");
    expect(columns[0].label).not.toBe(columns[0].printLabel);
    expect(columns[0].label).toContain("...");
    expect(columns[0].pinned).toBe(false);
    // Short names are left alone, and the pinned id is flagged.
    expect(columns[1].label).toBe("S2");
    expect(columns[1].pinned).toBe(true);
  });

  it("maps the missing-genus parent id to a max sort key", () => {
    renderVis();
    const rows = ctorData().rowLabels;
    expect(rows[0].sortKey).toBe(Number.MAX_SAFE_INTEGER);
    expect(rows[1].sortKey).toBe(55);
    expect(rows.map((r: $TSFixMe) => r.label)).toEqual(["Taxon A", "Taxon B"]);
  });

  it("wires the add-row callback only when onAddTaxon is supplied", () => {
    renderVis({ onAddTaxon: jest.fn() });
    expect(typeof ctorOptions().onAddRowClick).toBe("function");

    renderVis({ onAddTaxon: undefined });
    expect(ctorOptions().onAddRowClick).toBeNull();
  });

  it("wires pin-column only when the feature flag and handler are both present", () => {
    renderVis({ onPinSample: jest.fn() }, ["heatmap_pin_samples"]);
    expect(typeof ctorOptions().onPinColumnClick).toBe("function");

    renderVis({ onPinSample: jest.fn() }, []);
    expect(ctorOptions().onPinColumnClick).toBeNull();

    renderVis({ onPinSample: undefined }, ["heatmap_pin_samples"]);
    expect(ctorOptions().onPinColumnClick).toBeNull();
  });

  it("scrolls to the new taxon row on mount when newTaxon is set", () => {
    renderVis({ newTaxon: 200 });
    expect(heatmap().scrollToRow).toHaveBeenCalledWith("Taxon B");
  });

  it("does not scroll on mount when there is no new taxon", () => {
    renderVis();
    expect(heatmap().scrollToRow).not.toHaveBeenCalled();
  });
});

describe("SamplesHeatmapVis prop updates", () => {
  it("pushes a new scale into the heatmap only when it actually changes", () => {
    const { rerenderWith } = renderVis();
    rerenderWith({ scale: "symlog" });
    expect(heatmap().updateScale).not.toHaveBeenCalled();

    rerenderWith({ scale: "linear" });
    expect(heatmap().updateScale).toHaveBeenCalledWith("linear");
  });

  it("refreshes column labels when sampleDetails identity changes", () => {
    const { rerenderWith } = renderVis();
    rerenderWith({ sampleDetails: { ...SAMPLE_DETAILS } });
    expect(heatmap().updateData).toHaveBeenCalledWith({
      columnLabels: expect.any(Array),
    });
  });

  it("refreshes values and rows and re-scrolls when data changes", () => {
    const { rerenderWith } = renderVis({ newTaxon: 100 });
    heatmap().scrollToRow.mockClear();
    rerenderWith({ newTaxon: 100, data: { ...DATA } });
    expect(heatmap().updateData).toHaveBeenCalledWith(
      expect.objectContaining({ rowLabels: expect.any(Array) }),
    );
    expect(heatmap().scrollToRow).toHaveBeenCalledWith("Taxon A");
  });

  it("refreshes rows when the taxon id list changes", () => {
    const { rerenderWith } = renderVis();
    rerenderWith({ taxonIds: [200, 100] });
    expect(heatmap().updateData).toHaveBeenCalled();
  });

  it("refreshes columns when the pinned sample list changes", () => {
    const { rerenderWith } = renderVis();
    rerenderWith({ pinnedSampleIds: [1, 2] });
    const call = heatmap().updateData.mock.calls.at(-1)[0];
    expect(Object.keys(call)).toEqual(["columnLabels"]);
  });

  it("regenerates the print caption when applied filters change", () => {
    const { rerenderWith } = renderVis();
    rerenderWith({ appliedFilters: { categories: ["Viruses"] } });
    expect(heatmap().updatePrintCaption).toHaveBeenCalled();
  });

  it("toggles column and row sorting when the sort types change", () => {
    const { rerenderWith } = renderVis();
    rerenderWith({ sampleSortType: "cluster", taxaSortType: "cluster" });
    expect(heatmap().updateSortColumns).toHaveBeenCalledWith(false);
    expect(heatmap().updateSortRows).toHaveBeenCalledWith(false);
  });

  it("leaves the heatmap alone when nothing relevant changed", () => {
    const { rerenderWith } = renderVis();
    rerenderWith({});
    expect(heatmap().updateScale).not.toHaveBeenCalled();
    expect(heatmap().updateSortColumns).not.toHaveBeenCalled();
    expect(heatmap().updateSortRows).not.toHaveBeenCalled();
  });
});

describe("SamplesHeatmapVis colorScale", () => {
  it("keeps the original color for a positive, unfiltered-out cell", () => {
    const { ref } = renderVis();
    const color = ref.current.colorScale(
      5,
      { rowIndex: 0, columnIndex: 0 },
      "#red",
      null,
      "#none",
    );
    expect(color).toBe("#red");
  });

  it("greys out a zero value even when the cell passes the filters", () => {
    const { ref } = renderVis();
    expect(
      ref.current.colorScale(
        0,
        { rowIndex: 0, columnIndex: 0 },
        "#red",
        null,
        "#none",
      ),
    ).toBe("#none");
  });

  it("greys out a positive value in a filtered-out cell", () => {
    const { ref } = renderVis();
    expect(
      ref.current.colorScale(
        5,
        { rowIndex: 0, columnIndex: 1 },
        "#red",
        null,
        "#none",
      ),
    ).toBe("#none");
  });
});

describe("SamplesHeatmapVis caption strings", () => {
  it("formats threshold filters into a joined string", () => {
    const { ref } = renderVis();
    const result = ref.current.formatFilterString("thresholdFilters", [
      { metricDisplay: "NT rPM", operator: ">=", value: "10" },
      { metricDisplay: "NR r", operator: "<=", value: "3" },
    ]);
    expect(result.string).toBe("Thresholds: NT rPM >= 10,NR r <= 3");
    expect(result.numberOfFilters).toBe(2);
  });

  it("returns an empty threshold string when no thresholds are applied", () => {
    const { ref } = renderVis();
    const result = ref.current.formatFilterString("thresholdFilters", []);
    expect(result.string).toBe("");
    expect(result.numberOfFilters).toBe(0);
  });

  it("formats categories, taxon tags and read specificity", () => {
    const { ref } = renderVis();
    expect(
      ref.current.formatFilterString("categories", ["Bacteria", "Viruses"]),
    ).toEqual({ string: "Categories: Bacteria,Viruses", numberOfFilters: 2 });
    expect(ref.current.formatFilterString("taxonTags", ["lcrp"])).toEqual({
      string: "Pathogen Tags: lcrp",
      numberOfFilters: 1,
    });
    expect(ref.current.formatFilterString("readSpecificity", 1)).toEqual({
      string: "Read Specificity: Specific Only",
      numberOfFilters: 1,
    });
  });

  it("skips empty subcategory buckets", () => {
    const { ref } = renderVis();
    const result = ref.current.formatFilterString("subcategories", {
      Viruses: ["Phage"],
      Bacteria: [],
    });
    expect(result.string).toBe("Subcategories: Viruses - Phage");
    expect(result.numberOfFilters).toBe(1);
  });

  it("logs an error for an unknown filter name", () => {
    const { ref } = renderVis();
    const result = ref.current.formatFilterString("bogusFilter", "x");
    expect(result).toEqual({ string: "", numberOfFilters: 0 });
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { name: "bogusFilter", val: "x" },
      }),
    );
  });

  it("describes the applied filters and folds virus subcategories into categories", () => {
    const { ref } = renderVis();
    const caption = ref.current.generateHeatmapCaptions().join(" ");
    expect(caption).toContain("Showing NT.rpm for 10 taxa per sample");
    expect(caption).toContain("Background: NID Human CSF");
    expect(caption).toContain("Categories: Bacteria,Phage");
    expect(caption).toContain("Read Specificity: Specific Only");
    expect(caption).toContain("filter(s) applied");
    expect(caption).not.toContain("No filters applied.");
  });

  it("says no filters are applied when the applied filter set is empty", () => {
    const { ref } = renderVis({ appliedFilters: {} });
    const caption = ref.current.generateHeatmapCaptions();
    expect(caption).toContain("No filters applied.");
  });
});

describe("SamplesHeatmapVis hover state and tooltips", () => {
  it("builds tooltip sections for a cell with data that passes the filters", () => {
    const { ref } = renderVis();
    const tooltip = ref.current.getTooltipData({ rowIndex: 0, columnIndex: 0 });
    expect(tooltip.nodeHasData).toBe(true);
    expect(tooltip.subtitle).toBeNull();
    expect(tooltip.data.map((s: $TSFixMe) => s.name)).toEqual([
      "Info",
      "Values",
    ]);
    expect(tooltip.data[0].disabled).toBe(false);
    const values = tooltip.data[1].data;
    // NR.zscore is null in the fixture, so it renders as a dash.
    expect(values.find((v: $TSFixMe) => v[0] === "NR Z Score")[1]).toBe("-");
    // NT.zscore is rounded to 4 decimal places.
    expect(values.find((v: $TSFixMe) => v[0] === "NT Z Score")[1]).toBe(1.2346);
  });

  it("warns when the taxon is absent from the sample", () => {
    const { ref } = renderVis();
    const tooltip = ref.current.getTooltipData({ rowIndex: 1, columnIndex: 1 });
    expect(tooltip.nodeHasData).toBe(false);
    expect(tooltip.data.map((s: $TSFixMe) => s.name)).toEqual(["Info"]);
    expect(tooltip.subtitle).not.toBeNull();
  });

  it("warns and disables sections when the cell fails the threshold filters", () => {
    const { ref } = renderVis();
    const tooltip = ref.current.getTooltipData({ rowIndex: 0, columnIndex: 1 });
    expect(tooltip.nodeHasData).toBe(true);
    expect(tooltip.subtitle).not.toBeNull();
    expect(tooltip.data.every((s: $TSFixMe) => s.disabled)).toBe(true);
  });

  it("renders the node tooltip on hover and clears it on hover out", () => {
    const { ref } = renderVis();
    act(() => ref.current.handleNodeHover({ rowIndex: 0, columnIndex: 0 }));
    expect(screen.getByTestId("tooltip-viz-table")).toBeTruthy();

    act(() => ref.current.handleNodeHoverOut());
    expect(screen.queryByTestId("tooltip-viz-table")).toBeNull();
  });

  it("shows a single metadata pair when hovering a metadata node", () => {
    const { ref } = renderVis();
    act(() =>
      ref.current.handleMetadataNodeHover(
        { metadata: { collection_location: "SF" } },
        { value: "collection_location" },
      ),
    );
    expect(ref.current.state.columnMetadataLegend).toEqual({ SF: "#111111" });
    expect(screen.getByTestId("metadata-legend")).toBeTruthy();
  });

  it("falls back to Unknown for a metadata node with no value", () => {
    const { ref } = renderVis();
    act(() =>
      ref.current.handleMetadataNodeHover(
        { metadata: {} },
        { value: "collection_location" },
      ),
    );
    expect(ref.current.state.columnMetadataLegend).toEqual({
      Unknown: "#222222",
    });
  });

  it("shows the whole legend when hovering a metadata label and clears on out", () => {
    const { ref } = renderVis();
    act(() =>
      ref.current.handleColumnMetadataLabelHover({
        value: "collection_location",
      }),
    );
    expect(screen.getByTestId("metadata-legend")).toBeTruthy();

    act(() => ref.current.handleColumnMetadataLabelOut());
    expect(screen.queryByTestId("metadata-legend")).toBeNull();
  });

  it("labels a row group legend, defaulting an unknown genus", () => {
    const { ref } = renderVis();
    act(() =>
      ref.current.handleRowGroupEnter(
        { genusName: "Genus A" },
        { left: 10, width: 20, top: 5 },
        50,
      ),
    );
    expect(screen.getByTestId("row-group-legend").textContent).toBe(
      "Genus: Genus A",
    );
    expect(ref.current.state.rowGroupLegend.tooltipLocation).toEqual({
      left: 20,
      top: 50,
    });

    act(() =>
      ref.current.handleRowGroupEnter({}, { left: 0, width: 0, top: 90 }, 50),
    );
    expect(screen.getByTestId("row-group-legend").textContent).toBe(
      "Genus: Unknown",
    );
    expect(ref.current.state.rowGroupLegend.tooltipLocation.top).toBe(90);

    act(() => ref.current.handleRowGroupLeave());
    expect(screen.queryByTestId("row-group-legend")).toBeNull();
  });

  it("only reports a sample-label tooltip for duplicate sample names", () => {
    const { ref } = renderVis();
    expect(ref.current.getSampleTooltipData({ id: 2 })).toEqual({
      "Duplicate sample name": "",
    });
    expect(ref.current.getSampleTooltipData({ id: 1 })).toBeUndefined();

    act(() => ref.current.handleSampleLabelHover({ id: 2 }));
    expect(screen.getByTestId("metadata-legend")).toBeTruthy();
    act(() => ref.current.handleSampleLabelOut());
    expect(screen.queryByTestId("metadata-legend")).toBeNull();
  });

  it("shows the unpin popup while the pin icon is hovered", () => {
    const { ref } = renderVis();
    // tooltipLocation is only populated by a prior hover.
    act(() => ref.current.handleColumnMetadataLabelHover({ value: "x" }));
    act(() => ref.current.handlePinIconHover());
    expect(screen.getByTestId("basic-popup")).toBeTruthy();

    act(() => ref.current.handlePinIconExit());
    expect(screen.queryByTestId("basic-popup")).toBeNull();
  });
});

describe("SamplesHeatmapVis keyboard and cell clicks", () => {
  it("opens the sample view in a new tab on a plain cell click", () => {
    const { ref } = renderVis({ tempSelectedOptions: { background: 1 } });
    ref.current.handleCellClick({ columnIndex: 1 }, { metaKey: false });
    expect(mockOpenUrlInNewTab).toHaveBeenCalledWith("/samples/2", {
      metaKey: false,
    });
  });

  it("suppresses the cell click while the space bar is held for panning", () => {
    const { ref } = renderVis();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    });
    expect(ref.current.state.spacePressed).toBe(true);

    ref.current.handleCellClick({ columnIndex: 0 }, {});
    expect(mockOpenUrlInNewTab).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    });
    expect(ref.current.state.spacePressed).toBe(false);

    ref.current.handleCellClick({ columnIndex: 0 }, {});
    expect(mockOpenUrlInNewTab).toHaveBeenCalledWith("/samples/1", {});
  });

  it("ignores key events other than the space bar", () => {
    const { ref } = renderVis();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" }));
      document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyA" }));
    });
    expect(ref.current.state.spacePressed).toBeUndefined();
  });
});

describe("SamplesHeatmapVis selectors and zoom", () => {
  it("opens the taxon selector with the available taxa and closes it again", () => {
    const onAddTaxon = jest.fn();
    const { ref } = renderVis({ onAddTaxon });
    act(() => ref.current.handleAddTaxonClick({ id: "trigger" }));
    const selector = screen.getByTestId("taxon-selector");
    expect(JSON.parse(selector.textContent as string)).toEqual([
      { value: 100, label: "Taxon A", count: 2 },
      { value: 200, label: "Taxon B", count: 1 },
    ]);

    fireEvent.click(screen.getByTestId("taxon-selector-apply"));
    expect(onAddTaxon).toHaveBeenCalledWith([999]);

    fireEvent.click(screen.getByTestId("taxon-selector-close"));
    expect(screen.queryByTestId("taxon-selector")).toBeNull();
  });

  it("opens the pin-sample selector with pinned samples ordered first", () => {
    const { ref } = renderVis();
    act(() => ref.current.handlePinSampleClick({ id: "pin" }));
    const options = JSON.parse(
      screen.getByTestId("pin-sample-selector").textContent as string,
    );
    expect(options[0]).toEqual({ id: 2, name: "S2", pinned: true });
    expect(options[1].pinned).toBe(false);

    fireEvent.click(screen.getByTestId("pin-sample-close"));
    expect(screen.queryByTestId("pin-sample-selector")).toBeNull();
  });

  it("offers only metadata types that have both a key and a name", () => {
    const { ref } = renderVis();
    act(() => ref.current.handleAddColumnMetadataClick({ id: "meta" }));
    const types = JSON.parse(
      screen.getByTestId("metadata-selector").textContent as string,
    );
    expect(types).toEqual([
      { value: "collection_location", label: "Location" },
    ]);

    fireEvent.click(screen.getByTestId("metadata-selector-close"));
    expect(screen.queryByTestId("metadata-selector")).toBeNull();
  });

  it("pushes the selected metadata (minus unknown keys) into the heatmap", () => {
    const onMetadataChange = jest.fn();
    const { ref } = renderVis({ onMetadataChange });
    const selection = new Set(["collection_location", "unknown_type"]);
    act(() => ref.current.handleSelectedMetadataChange(selection));
    expect(heatmap().updateColumnMetadata).toHaveBeenCalledWith([
      { value: "collection_location", label: "Location" },
    ]);
    expect(onMetadataChange).toHaveBeenCalledWith(selection);
  });

  it("tolerates a missing onMetadataChange callback", () => {
    const { ref } = renderVis({ onMetadataChange: undefined });
    act(() =>
      ref.current.handleSelectedMetadataChange(
        new Set(["collection_location"]),
      ),
    );
    expect(heatmap().updateColumnMetadata).toHaveBeenCalled();
  });

  it("clamps zoom between 0.2 and 3", () => {
    const { ref } = renderVis();
    fireEvent.click(screen.getByTestId("zoom-plus"));
    expect(heatmap().updateZoom).toHaveBeenLastCalledWith(1.25);

    heatmap().options.zoom = 2.9;
    ref.current.handleZoom(1);
    expect(heatmap().updateZoom).toHaveBeenLastCalledWith(3);

    heatmap().options.zoom = 0.25;
    fireEvent.click(screen.getByTestId("zoom-minus"));
    expect(heatmap().updateZoom).toHaveBeenLastCalledWith(0.2);
  });
});

describe("SamplesHeatmapVis banner, names toggle and downloads", () => {
  it("hides the controls banner when its close icon is clicked", () => {
    const { ref } = renderVis();
    expect(ref.current.state.displayControlsBanner).toBe(true);
    fireEvent.click(screen.getAllByTestId("icon-close")[0]);
    expect(ref.current.state.displayControlsBanner).toBe(false);
  });

  it("toggles between full and truncated sample names", () => {
    const { ref } = renderVis();
    const toggle = screen.getByTestId("toggle-names");
    expect(toggle.getAttribute("data-on")).toBe("false");

    fireEvent.click(toggle);
    expect(ref.current.state.showingFullNames).toBe(true);
    let labels = heatmap().updateData.mock.calls.at(-1)[0].columnLabels;
    expect(labels[0].label).toBe("Sample One With A Really Long Name");

    fireEvent.click(screen.getByTestId("toggle-names"));
    expect(ref.current.state.showingFullNames).toBe(false);
    labels = heatmap().updateData.mock.calls.at(-1)[0].columnLabels;
    expect(labels[0].label).toContain("...");
  });

  it("forces truncation when toggleFullNames is called with 'truncated'", () => {
    const { ref } = renderVis();
    act(() => ref.current.toggleFullNames());
    expect(ref.current.state.showingFullNames).toBe(true);

    act(() => ref.current.toggleFullNames("truncated"));
    expect(ref.current.state.showingFullNames).toBe(false);
    const labels = heatmap().updateData.mock.calls.at(-1)[0].columnLabels;
    expect(labels[0].label).toContain("...");
  });

  it("disables the toggle when no sample name is long enough to truncate", () => {
    renderVis({
      sampleIds: [2],
      sampleDetails: { 2: SAMPLE_DETAILS[2] },
      pinnedSampleIds: [],
    });
    expect(
      (screen.getByTestId("toggle-names") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("delegates the download and CSV entry points to the heatmap", () => {
    const { ref } = renderVis();
    ref.current.download();
    expect(heatmap().download).toHaveBeenCalledWith(
      ref.current.toggleFullNames,
    );

    ref.current.downloadAsPng();
    expect(heatmap().downloadAsPng).toHaveBeenCalled();

    expect(
      ref.current.computeCurrentHeatmapViewValuesForCSV({ headers: ["Taxon"] }),
    ).toEqual(["csv"]);
    expect(
      heatmap().computeCurrentHeatmapViewValuesForCSV,
    ).toHaveBeenCalledWith({ headers: ["Taxon"] });
  });

  it("forwards wheel scrolling to the heatmap and stops the native event", () => {
    const { ref } = renderVis();
    const event = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      stopImmediatePropagation: jest.fn(),
    };
    mockD3.event = event;
    ref.current.scroll();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopImmediatePropagation).toHaveBeenCalled();
    expect(heatmap().scroll).toHaveBeenCalledWith(event);
  });

  it("detaches its listeners on unmount", () => {
    const removeSpy = jest.spyOn(document, "removeEventListener");
    const { unmount } = renderVis();
    unmount();
    const removedEvents = removeSpy.mock.calls.map(c => c[0]);
    expect(removedEvents).toContain("keydown");
    expect(removedEvents).toContain("keyup");
    removeSpy.mockRestore();
  });
});

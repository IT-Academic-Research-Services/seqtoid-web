// Coverage: app/assets/src/components/views/SampleView/components/MngsReport/components/ReportFilters/ReportFilters.tsx
//
// ReportFilters is the mNGS report filter bar: it decides which filter controls
// to show for the current tab and view, funnels every control's onChange through
// a single analytics + dispatch path, and renders removable tags for the active
// selections. Each filter control is stubbed with a minimal button so the tests
// can drive the callbacks without pulling in the dropdown machinery; the
// assertions are all on this component's own branching (tab, view, background,
// tag removal keys).
import { fireEvent, render, screen } from "@testing-library/react";

const mockTrackEvent = jest.fn();

jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: {
    SAMPLE_VIEW_FILTER_CHANGED: "SAMPLE_VIEW_FILTER_CHANGED",
    SAMPLE_VIEW_FILTER_CHANGED_ALLISON_TESTING:
      "SAMPLE_VIEW_FILTER_CHANGED_ALLISON_TESTING",
  },
  useTrackEvent: () => mockTrackEvent,
}));

jest.mock("~ui/controls/SearchBox", () => ({
  __esModule: true,
  default: ({ onResultSelect, placeholder }: $TSFixMe) => (
    <button
      data-testid="search-box"
      onClick={() =>
        onResultSelect(null, {
          result: { taxid: 573, level: 1, title: "Klebsiella pneumoniae" },
        })
      }
    >
      {placeholder}
    </button>
  ),
}));

jest.mock("~ui/controls/FilterTag", () => ({
  __esModule: true,
  default: ({ text, onClose }: $TSFixMe) => (
    <button data-testid="filter-tag" onClick={onClose}>
      {text}
    </button>
  ),
}));

jest.mock("~/components/common/ThresholdFilterTag", () => ({
  __esModule: true,
  default: ({ threshold, onClose }: $TSFixMe) => (
    <button data-testid="threshold-tag" onClick={onClose}>
      {threshold.metric}
    </button>
  ),
}));

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/NameTypeFilter",
  () => ({
    __esModule: true,
    default: ({ onChange, value }: $TSFixMe) => (
      <button
        data-testid="name-type-filter"
        data-value={String(value)}
        onClick={() => onChange("Scientific name")}
      />
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/BackgroundModelFilter",
  () => ({
    __esModule: true,
    default: ({
      onChange,
      value,
      enableMassNormalizedBackgrounds,
      allBackgrounds,
    }: $TSFixMe) => (
      <button
        data-testid="background-model-filter"
        data-value={String(value)}
        data-mass-normalized={String(enableMassNormalizedBackgrounds)}
        data-background-count={String((allBackgrounds || []).length)}
        onClick={() => onChange(0)}
      />
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/CategoryFilter",
  () => ({
    __esModule: true,
    default: ({
      onChange,
      selectedCategories,
      selectedSubcategories,
      categoryParentChild,
      categoryChildParent,
    }: $TSFixMe) => (
      <button
        data-testid="category-filter-control"
        data-selected={selectedCategories.join(",")}
        data-selected-sub={selectedSubcategories.join(",")}
        data-parent-child={JSON.stringify(categoryParentChild)}
        data-child-parent={JSON.stringify(categoryChildParent)}
        onClick={() => onChange(["Bacteria"], ["Phage"])}
      />
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/ThresholdFilterDropdown/ThresholdFilterDropdown",
  () => ({
    __esModule: true,
    default: ({ onApply, options, thresholds }: $TSFixMe) => (
      <button
        data-testid="threshold-dropdown"
        data-target-count={String(options.targets.length)}
        data-threshold-count={String(thresholds.length)}
        onClick={() =>
          onApply([{ metric: "nt_zscore", operator: ">=", value: "2" }])
        }
      />
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/SpecificityFilter",
  () => ({
    __esModule: true,
    default: ({ onChange }: $TSFixMe) => (
      <button data-testid="specificity-filter" onClick={() => onChange(1)} />
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/AnnotationFilter",
  () => ({
    __esModule: true,
    default: ({ onChange, selectedAnnotations }: $TSFixMe) => (
      <button
        data-testid="annotation-filter"
        data-selected={(selectedAnnotations || []).join(",")}
        onClick={() => onChange("Hit")}
      />
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/FlagFilter",
  () => ({
    __esModule: true,
    default: ({ onChange, selectedFlags }: $TSFixMe) => (
      <button
        data-testid="flag-filter"
        data-selected={(selectedFlags || []).join(",")}
        onClick={() => onChange("divergent")}
      />
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/MetricPicker",
  () => ({
    __esModule: true,
    default: ({ onChange, options, value }: $TSFixMe) => (
      <button
        data-testid="metric-picker"
        data-value={String(value)}
        data-options={options.map((o: $TSFixMe) => o.value).join(",")}
        onClick={() => onChange("nt_rpm")}
      />
    ),
  }),
);

import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { ReportFilters } from "~/components/views/SampleView/components/MngsReport/components/ReportFilters/ReportFilters";

const baseSelected = (overrides: $TSFixMe = {}) =>
  ({
    taxa: [],
    thresholdsShortReads: [],
    thresholdsLongReads: [],
    annotations: [],
    flags: [],
    categories: { categories: [], subcategories: {} },
    background: null,
    nameType: "Scientific name",
    readSpecificity: 0,
    metricShortReads: undefined,
    metricLongReads: undefined,
    ...overrides,
  } as $TSFixMe);

const renderFilters = (props: $TSFixMe = {}) => {
  const dispatchSelectedOptions = jest.fn();
  const selected = props.selected ?? baseSelected();
  const utils = render(
    <ReportFilters
      currentTab={props.currentTab ?? WORKFLOW_TABS.SHORT_READ_MNGS}
      dispatchSelectedOptions={dispatchSelectedOptions}
      selected={selected}
      sampleId={42 as $TSFixMe}
      projectId={7 as $TSFixMe}
      {...props}
    />,
  );
  return { dispatchSelectedOptions, selected, ...utils };
};

beforeEach(() => {
  mockTrackEvent.mockClear();
});

describe("ReportFilters layout", () => {
  it("shows the background filter on the short-read tab", () => {
    renderFilters();
    expect(screen.getByTestId("background-model-filter")).toBeTruthy();
    expect(screen.getByTestId("search-box")).toBeTruthy();
    expect(screen.getByTestId("category-filter-control")).toBeTruthy();
    expect(screen.getByTestId("threshold-dropdown")).toBeTruthy();
    expect(screen.getByTestId("specificity-filter")).toBeTruthy();
  });

  it("hides the background filter on the long-read tab", () => {
    renderFilters({ currentTab: WORKFLOW_TABS.LONG_READ_MNGS });
    expect(screen.queryByTestId("background-model-filter")).toBeNull();
  });

  it("hides the taxon search box for a snapshot share link", () => {
    renderFilters({ snapshotShareId: "abc123" });
    expect(screen.queryByTestId("search-box")).toBeNull();
  });

  it("shows the annotation and flag filters only in table view", () => {
    const { unmount } = renderFilters({ view: "table" });
    expect(screen.getByTestId("annotation-filter")).toBeTruthy();
    expect(screen.getByTestId("flag-filter")).toBeTruthy();
    expect(screen.queryByTestId("metric-picker")).toBeNull();
    unmount();

    renderFilters({ view: "tree" });
    expect(screen.queryByTestId("annotation-filter")).toBeNull();
    expect(screen.queryByTestId("flag-filter")).toBeNull();
    expect(screen.getByTestId("metric-picker")).toBeTruthy();
  });

  it("drops the aggregate score metric when no background is selected", () => {
    renderFilters({ view: "tree" });
    const picker = screen.getByTestId("metric-picker");
    expect(picker.dataset.options).not.toContain("aggregatescore");
    // With no explicit metric, the first available option is used.
    expect(picker.dataset.value).toBe("nt_r");
  });

  it("keeps the aggregate score metric when a background is selected", () => {
    renderFilters({
      view: "tree",
      selected: baseSelected({ background: 12, metricShortReads: "nt_rpm" }),
    });
    const picker = screen.getByTestId("metric-picker");
    expect(picker.dataset.options).toContain("aggregatescore");
    expect(picker.dataset.value).toBe("nt_rpm");
  });

  it("uses the long-read metric on the long-read tab", () => {
    renderFilters({
      view: "tree",
      currentTab: WORKFLOW_TABS.LONG_READ_MNGS,
      selected: baseSelected({ metricLongReads: "nt_bpm" }),
    });
    expect(screen.getByTestId("metric-picker").dataset.value).toBe("nt_bpm");
  });

  it("passes the per-tab threshold targets and current thresholds down", () => {
    const shortRead = renderFilters({
      selected: baseSelected({
        thresholdsShortReads: [
          { metric: "nt_zscore", operator: ">=", value: "2" },
        ],
      }),
    });
    const shortDropdown = screen.getByTestId("threshold-dropdown");
    expect(Number(shortDropdown.dataset.targetCount)).toBeGreaterThan(0);
    expect(shortDropdown.dataset.thresholdCount).toBe("1");
    shortRead.unmount();

    renderFilters({
      currentTab: WORKFLOW_TABS.LONG_READ_MNGS,
      selected: baseSelected({
        thresholdsLongReads: [
          { metric: "nt_bpm", operator: ">=", value: "1" },
          { metric: "nr_bpm", operator: "<=", value: "9" },
        ],
      }),
    });
    expect(
      screen.getByTestId("threshold-dropdown").dataset.thresholdCount,
    ).toBe("2");
  });

  it("derives the category parent/child maps from CATEGORIES", () => {
    renderFilters({
      selected: baseSelected({
        categories: {
          categories: ["Viruses"],
          subcategories: { Viruses: ["Phage"] },
        },
      }),
    });
    const categoryFilter = screen.getByTestId("category-filter-control");
    expect(JSON.parse(categoryFilter.dataset.parentChild as string)).toEqual({
      Viruses: ["Phage"],
    });
    expect(JSON.parse(categoryFilter.dataset.childParent as string)).toEqual({
      Phage: "Viruses",
    });
    expect(categoryFilter.dataset.selected).toBe("Viruses");
    expect(categoryFilter.dataset.selectedSub).toBe("Phage");
  });
});

describe("ReportFilters change handling", () => {
  it("dispatches optionChanged and tracks the event when a filter changes", () => {
    const { dispatchSelectedOptions } = renderFilters();
    fireEvent.click(screen.getByTestId("name-type-filter"));

    expect(dispatchSelectedOptions).toHaveBeenCalledWith({
      type: "optionChanged",
      payload: { key: "nameType", value: "Scientific name" },
    });
    expect(mockTrackEvent).toHaveBeenCalledTimes(2);
    expect(mockTrackEvent.mock.calls[0][0]).toBe("SAMPLE_VIEW_FILTER_CHANGED");
    expect(mockTrackEvent.mock.calls[1][1].value).toBe('"Scientific name"');
  });

  it("converts the 'none' background sentinel to null", () => {
    const { dispatchSelectedOptions } = renderFilters();
    fireEvent.click(screen.getByTestId("background-model-filter"));

    expect(dispatchSelectedOptions).toHaveBeenCalledWith({
      type: "optionChanged",
      payload: { key: "background", value: null },
    });
  });

  it("dispatches the selected taxon from the search box", () => {
    const { dispatchSelectedOptions } = renderFilters();
    fireEvent.click(screen.getByTestId("search-box"));

    expect(dispatchSelectedOptions).toHaveBeenCalledWith({
      type: "optionChanged",
      payload: {
        key: "taxa",
        value: [{ id: 573, level: 1, name: "Klebsiella pneumoniae" }],
      },
    });
  });

  it("dispatches categories with both levels", () => {
    const { dispatchSelectedOptions } = renderFilters();
    fireEvent.click(screen.getByTestId("category-filter-control"));

    expect(dispatchSelectedOptions).toHaveBeenCalledWith({
      type: "optionChanged",
      payload: {
        key: "categories",
        value: { categories: ["Bacteria"], subcategories: ["Phage"] },
      },
    });
  });

  it("dispatches thresholds under the tab-specific key", () => {
    const shortRead = renderFilters();
    fireEvent.click(screen.getByTestId("threshold-dropdown"));
    expect(shortRead.dispatchSelectedOptions.mock.calls[0][0].payload.key).toBe(
      "thresholdsShortReads",
    );
    shortRead.unmount();

    const longRead = renderFilters({
      currentTab: WORKFLOW_TABS.LONG_READ_MNGS,
    });
    fireEvent.click(screen.getByTestId("threshold-dropdown"));
    expect(longRead.dispatchSelectedOptions.mock.calls[0][0].payload.key).toBe(
      "thresholdsLongReads",
    );
  });

  it("dispatches annotation and flag changes in table view", () => {
    const { dispatchSelectedOptions } = renderFilters({ view: "table" });
    fireEvent.click(screen.getByTestId("annotation-filter"));
    fireEvent.click(screen.getByTestId("flag-filter"));

    expect(dispatchSelectedOptions).toHaveBeenNthCalledWith(1, {
      type: "optionChanged",
      payload: { key: "annotations", value: "Hit" },
    });
    expect(dispatchSelectedOptions).toHaveBeenNthCalledWith(2, {
      type: "optionChanged",
      payload: { key: "flags", value: "divergent" },
    });
  });

  it("dispatches the metric under the tab-specific key in tree view", () => {
    const { dispatchSelectedOptions } = renderFilters({ view: "tree" });
    fireEvent.click(screen.getByTestId("metric-picker"));
    expect(dispatchSelectedOptions).toHaveBeenCalledWith({
      type: "optionChanged",
      payload: { key: "metricShortReads", value: "nt_rpm" },
    });
  });

  it("dispatches read specificity changes", () => {
    const { dispatchSelectedOptions } = renderFilters();
    fireEvent.click(screen.getByTestId("specificity-filter"));
    expect(dispatchSelectedOptions).toHaveBeenCalledWith({
      type: "optionChanged",
      payload: { key: "readSpecificity", value: 1 },
    });
  });
});

describe("ReportFilters tag list", () => {
  it("renders no tags while the report is loading", () => {
    renderFilters({
      loadingReport: true,
      selected: baseSelected({
        taxa: [{ id: 1, name: "Klebsiella", level: 1 }],
      }),
    });
    expect(screen.queryAllByTestId("filter-tag")).toHaveLength(0);
  });

  it("renders a tag per taxon, threshold, category and annotation", () => {
    renderFilters({
      selected: baseSelected({
        taxa: [{ id: 1, name: "Klebsiella", level: 1 }],
        thresholdsShortReads: [
          { metric: "nt_zscore", operator: ">=", value: "2" },
        ],
        annotations: ["Hit"],
        categories: {
          categories: ["Viruses"],
          subcategories: { Viruses: ["Phage"] },
        },
      }),
    });

    const labels = screen
      .getAllByTestId("filter-tag")
      .map(el => el.textContent);
    expect(labels).toEqual(["Klebsiella", "Viruses", "Phage", "Hit"]);
    expect(screen.getAllByTestId("threshold-tag")).toHaveLength(1);
  });

  it("removes a taxon tag by pulling it out of the taxa list", () => {
    const taxon = { id: 1, name: "Klebsiella", level: 1 };
    const other = { id: 2, name: "E. coli", level: 1 };
    const { dispatchSelectedOptions } = renderFilters({
      selected: baseSelected({ taxa: [taxon, other] }),
    });

    fireEvent.click(screen.getAllByTestId("filter-tag")[0]);
    expect(dispatchSelectedOptions).toHaveBeenCalledWith({
      type: "clear",
      payload: expect.objectContaining({ taxa: [other] }),
    });
  });

  it("removes a threshold tag under the short-read key", () => {
    const threshold = { metric: "nt_zscore", operator: ">=", value: "2" };
    const { dispatchSelectedOptions } = renderFilters({
      selected: baseSelected({ thresholdsShortReads: [threshold] }),
    });

    fireEvent.click(screen.getByTestId("threshold-tag"));
    expect(dispatchSelectedOptions).toHaveBeenCalledWith({
      type: "clear",
      payload: expect.objectContaining({ thresholdsShortReads: [] }),
    });
  });

  it("removes a threshold tag under the long-read key", () => {
    const threshold = { metric: "nt_bpm", operator: ">=", value: "1" };
    const { dispatchSelectedOptions } = renderFilters({
      currentTab: WORKFLOW_TABS.LONG_READ_MNGS,
      selected: baseSelected({ thresholdsLongReads: [threshold] }),
    });

    fireEvent.click(screen.getByTestId("threshold-tag"));
    expect(dispatchSelectedOptions).toHaveBeenCalledWith({
      type: "clear",
      payload: expect.objectContaining({ thresholdsLongReads: [] }),
    });
  });

  it("removes a category tag from the categories subpath", () => {
    const { dispatchSelectedOptions } = renderFilters({
      selected: baseSelected({
        categories: {
          categories: ["Viruses", "Bacteria"],
          subcategories: {},
        },
      }),
    });

    // Tag order follows CATEGORIES: Bacteria comes before Viruses.
    fireEvent.click(screen.getAllByTestId("filter-tag")[0]);
    const payload = dispatchSelectedOptions.mock.calls[0][0].payload;
    expect(payload.categories.categories).toEqual(["Viruses"]);
  });

  it("removes a subcategory tag from the subcategories subpath", () => {
    const { dispatchSelectedOptions } = renderFilters({
      selected: baseSelected({
        categories: {
          categories: [],
          subcategories: { Viruses: ["Phage"] },
        },
      }),
    });

    fireEvent.click(screen.getByTestId("filter-tag"));
    const payload = dispatchSelectedOptions.mock.calls[0][0].payload;
    expect(payload.categories.subcategories.Viruses).toEqual([]);
  });

  it("removes an annotation tag", () => {
    const { dispatchSelectedOptions } = renderFilters({
      selected: baseSelected({ annotations: ["Hit", "Not a hit"] }),
    });

    fireEvent.click(screen.getAllByTestId("filter-tag")[0]);
    expect(dispatchSelectedOptions).toHaveBeenCalledWith({
      type: "clear",
      payload: expect.objectContaining({ annotations: ["Not a hit"] }),
    });
  });
});

// Coverage for
// app/assets/src/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/SamplesHeatmapFilters.tsx
//
// This panel is a wiring layer: for each filter it decides whether the control
// is disabled (loading / no data / locked by a preset), whether it must be
// wrapped in the preset tooltip, which options are greyed out (Z-score metrics
// need a background model) and what shape the change event takes -- including
// the "same value selected, do nothing" short-circuits. The child controls are
// stubbed so those decisions can be asserted directly from the props they
// receive and the callbacks they are handed.
import { render, screen } from "@testing-library/react";
import React from "react";
import { SamplesHeatmapFilters } from "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/SamplesHeatmapFilters";

// Props captured from the stubbed children, keyed by a stable label.
const captured: Record<string, $TSFixMe> = {};

jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapViewOptionsDropdown",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => {
      captured[props.label] = props;
      return (
        <div
          data-testid={`dropdown-${props.label}`}
          data-disabled={String(props.disabled)}
        />
      );
    },
  }),
);

jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapBackgroundDropdown",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => {
      captured.background = props;
      return (
        <div
          data-testid="dropdown-background"
          data-disabled={String(props.disabled)}
        />
      );
    },
  }),
);

jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapCategoryDropdown",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => {
      captured.categories = props;
      return (
        <div
          data-testid="dropdown-categories"
          data-disabled={String(props.disabled)}
        />
      );
    },
  }),
);

jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapTaxonSlider",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => {
      captured.taxonSlider = props;
      return (
        <div
          data-testid="taxon-slider"
          data-disabled={String(props.isDisabled)}
        />
      );
    },
  }),
);

jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapTaxonTagCheckbox",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => {
      captured.taxonTag = props;
      return (
        <div
          data-testid="taxon-tag-checkbox"
          data-disabled={String(props.disabled)}
        />
      );
    },
  }),
);

jest.mock(
  "~/components/views/SamplesHeatmapView/components/SamplesHeatmapFilters/components/SamplesHeatmapPresetTooltip",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => (
      <div data-testid="preset-tooltip">{props.component}</div>
    ),
  }),
);

jest.mock("~/components/common/filters/ThresholdFilterSDS", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    captured.thresholds = props;
    return (
      <div
        data-testid="threshold-filter"
        data-disabled={String(props.disabled)}
      />
    );
  },
}));

jest.mock("~/components/common/MenuOptionWithDisabledTooltip", () => ({
  MenuOptionWithDisabledTooltip: (props: $TSFixMe) => (
    <div data-testid="menu-option">{props.option.name}</div>
  ),
}));

// Keeps organize-imports from dropping the React import the classic JSX runtime needs.
const _React: typeof React = React;

const defaultOptions = () => ({
  metrics: [
    { text: "NT rPM", value: "NT.rpm" },
    { text: "NT Z Score", value: "NT.zscore" },
  ],
  categories: ["Bacteria", "Viruses"],
  subcategories: { Viruses: ["Phage"] },
  backgrounds: [{ id: 1, name: "Background one" }],
  taxonLevels: [
    { text: "Genus", value: 0 },
    { text: "Species", value: 1 },
  ],
  specificityOptions: [
    { text: "All", value: 0 },
    { text: "Specific Only", value: 1 },
  ],
  sampleSortTypeOptions: [{ text: "Cluster", value: "cluster" }],
  taxaSortTypeOptions: [{ text: "Cluster", value: "cluster" }],
  thresholdFilters: {
    operators: [">=", "<="],
    targets: [
      { text: "NT rPM", value: "NT_rpm" },
      { text: "NT Z Score", value: "NT_zscore" },
    ],
  },
  scales: [
    ["Log", "symlog"],
    ["Lin", "linear"],
  ],
  taxonsPerSample: { min: 1, max: 100 },
});

const defaultSelected = () => ({
  species: 1,
  metric: "NT.rpm",
  background: 1,
  thresholdFilters: [],
  readSpecificity: 1,
  sampleSortType: "cluster",
  taxaSortType: "cluster",
  dataScaleIdx: 0,
  taxonsPerSample: 20,
  categories: [],
  subcategories: {},
  presets: [],
});

const renderFilters = (props: $TSFixMe = {}) => {
  const onSelectedOptionsChange = jest.fn();
  const utils = render(
    <SamplesHeatmapFilters
      data={{ NT_rpm: [[1]] }}
      loading={false}
      options={defaultOptions() as $TSFixMe}
      selectedOptions={
        { ...defaultSelected(), ...(props.selectedOptions || {}) } as $TSFixMe
      }
      onSelectedOptionsChange={onSelectedOptionsChange}
      enableMassNormalizedBackgrounds
      {...props}
      // selectedOptions is merged above; do not let the spread clobber it.
      {...(props.selectedOptions
        ? {
            selectedOptions: {
              ...defaultSelected(),
              ...props.selectedOptions,
            } as $TSFixMe,
          }
        : {})}
    />,
  );
  return { ...utils, onSelectedOptionsChange };
};

const disabledOf = (testId: string) =>
  screen.getByTestId(testId).getAttribute("data-disabled");

beforeEach(() => {
  Object.keys(captured).forEach(k => delete captured[k]);
});

describe("SamplesHeatmapFilters layout", () => {
  it("renders every filter and view-option control", () => {
    renderFilters();
    ["Taxon Level", "Metric", "Sort Samples", "Sort Taxa", "Scale"].forEach(
      label => expect(screen.getByTestId(`dropdown-${label}`)).toBeTruthy(),
    );
    expect(screen.getByTestId("dropdown-background")).toBeTruthy();
    expect(screen.getByTestId("dropdown-categories")).toBeTruthy();
    expect(screen.getByTestId("threshold-filter")).toBeTruthy();
    expect(screen.getByTestId("taxon-slider")).toBeTruthy();
    expect(screen.getByTestId("taxon-tag-checkbox")).toBeTruthy();
  });

  it("wraps nothing in the preset tooltip when no presets are locked", () => {
    renderFilters();
    expect(screen.queryAllByTestId("preset-tooltip")).toHaveLength(0);
    expect(disabledOf("dropdown-Taxon Level")).toBe("false");
  });
});

describe("SamplesHeatmapFilters disabled states", () => {
  it("disables every control while loading", () => {
    renderFilters({ loading: true });
    expect(disabledOf("dropdown-Taxon Level")).toBe("true");
    expect(disabledOf("dropdown-Metric")).toBe("true");
    expect(disabledOf("dropdown-Sort Samples")).toBe("true");
    expect(disabledOf("dropdown-Sort Taxa")).toBe("true");
    expect(disabledOf("dropdown-Scale")).toBe("true");
    expect(disabledOf("dropdown-background")).toBe("true");
    expect(disabledOf("dropdown-categories")).toBe("true");
    expect(disabledOf("threshold-filter")).toBe("true");
    expect(disabledOf("taxon-slider")).toBe("true");
    expect(disabledOf("taxon-tag-checkbox")).toBe("true");
  });

  it("disables every control when there is no heatmap data yet", () => {
    renderFilters({ data: undefined });
    expect(disabledOf("dropdown-Taxon Level")).toBe("true");
    expect(disabledOf("threshold-filter")).toBe("true");
    expect(disabledOf("taxon-slider")).toBe("true");
  });
});

describe("SamplesHeatmapFilters presets", () => {
  const presetCases: [string, string][] = [
    ["species", "dropdown-Taxon Level"],
    ["background", "dropdown-background"],
    ["thresholdFilters", "threshold-filter"],
    ["categories", "dropdown-categories"],
    ["readSpecificity", "dropdown-Read Specificity"],
  ];

  presetCases.forEach(([preset, testId]) => {
    it(`locks and tooltips the ${preset} control when it is a preset`, () => {
      renderFilters({ selectedOptions: { presets: [preset] } });
      expect(screen.getAllByTestId("preset-tooltip")).toHaveLength(1);
      expect(disabledOf(testId)).toBe("true");
    });
  });

  it("also locks the category control when only subcategories are preset", () => {
    renderFilters({ selectedOptions: { presets: ["subcategories"] } });
    expect(disabledOf("dropdown-categories")).toBe("true");
    expect(screen.getAllByTestId("preset-tooltip")).toHaveLength(1);
  });

  it("leaves the always-unlockable sort controls enabled under presets", () => {
    renderFilters({ selectedOptions: { presets: ["species", "background"] } });
    expect(disabledOf("dropdown-Sort Samples")).toBe("false");
    expect(disabledOf("dropdown-Sort Taxa")).toBe("false");
    expect(screen.getAllByTestId("preset-tooltip")).toHaveLength(2);
  });
});

describe("SamplesHeatmapFilters change handlers", () => {
  const cases: [string, string, $TSFixMe, $TSFixMe, string][] = [
    ["Taxon Level", "species", { value: 0 }, { value: 1 }, "species"],
    ["Metric", "metric", { value: "NT.zscore" }, { value: "NT.rpm" }, "metric"],
    [
      "Read Specificity",
      "readSpecificity",
      { value: 0 },
      { value: 1 },
      "readSpecificity",
    ],
    [
      "Sort Samples",
      "sampleSortType",
      { value: "alpha" },
      { value: "cluster" },
      "sampleSortType",
    ],
    [
      "Sort Taxa",
      "taxaSortType",
      { value: "alpha" },
      { value: "cluster" },
      "taxaSortType",
    ],
    ["Scale", "dataScaleIdx", { value: 1 }, { value: 0 }, "dataScaleIdx"],
  ];

  cases.forEach(([label, , changed, unchanged, key]) => {
    it(`${label} reports a new selection`, () => {
      const { onSelectedOptionsChange } = renderFilters();
      captured[label].onChange(changed);
      expect(onSelectedOptionsChange).toHaveBeenCalledWith({
        [key]: changed.value,
      });
    });

    it(`${label} ignores a re-selection of the current value`, () => {
      const { onSelectedOptionsChange } = renderFilters();
      captured[label].onChange(unchanged);
      expect(onSelectedOptionsChange).not.toHaveBeenCalled();
    });
  });

  it("the background dropdown reports and de-duplicates its selection", () => {
    const { onSelectedOptionsChange } = renderFilters();
    captured.background.onChange(1);
    expect(onSelectedOptionsChange).not.toHaveBeenCalled();
    captured.background.onChange(2);
    expect(onSelectedOptionsChange).toHaveBeenCalledWith({ background: 2 });
  });

  it("applying thresholds forwards the whole filter list", () => {
    const { onSelectedOptionsChange } = renderFilters();
    const thresholds = [{ metric: "NT_rpm", operator: ">=", value: "10" }];
    captured.thresholds.onApply(thresholds);
    expect(onSelectedOptionsChange).toHaveBeenCalledWith({
      thresholdFilters: thresholds,
    });
  });

  it("committing the taxons-per-sample slider forwards the new value", () => {
    const { onSelectedOptionsChange } = renderFilters();
    expect(captured.taxonSlider.min).toBe(1);
    expect(captured.taxonSlider.max).toBe(100);
    expect(captured.taxonSlider.value).toBe(20);
    captured.taxonSlider.onChangeCommitted(45);
    expect(onSelectedOptionsChange).toHaveBeenCalledWith({
      taxonsPerSample: 45,
    });
  });

  it("hands the category dropdown the shared change callback", () => {
    const { onSelectedOptionsChange } = renderFilters();
    expect(captured.categories.onSelectedOptionsChange).toBe(
      onSelectedOptionsChange,
    );
    expect(captured.categories.options.categories).toEqual([
      "Bacteria",
      "Viruses",
    ]);
  });
});

describe("SamplesHeatmapFilters z-score gating", () => {
  it("greys out Z-score metrics and thresholds without a background model", () => {
    renderFilters({ selectedOptions: { background: null } });
    const metricOptions = captured.Metric.options;
    expect(metricOptions.find(o => o.value === "NT.rpm").disabled).toBe(false);
    expect(metricOptions.find(o => o.value === "NT.zscore").disabled).toBe(
      true,
    );

    const thresholdOptions = captured.thresholds.metricOptions;
    expect(thresholdOptions.find(o => o.value === "NT_rpm").disabled).toBe(
      false,
    );
    expect(thresholdOptions.find(o => o.value === "NT_zscore").disabled).toBe(
      true,
    );
  });

  it("enables Z-score metrics and thresholds once a background is chosen", () => {
    renderFilters();
    expect(
      captured.Metric.options.find(o => o.value === "NT.zscore").disabled,
    ).toBe(false);
    expect(
      captured.thresholds.metricOptions.find(o => o.value === "NT_zscore")
        .disabled,
    ).toBe(false);
  });

  it("copies text into the SDS `name` field the dropdowns key off", () => {
    renderFilters();
    expect(captured["Taxon Level"].options).toEqual([
      { text: "Genus", name: "Genus", value: 0 },
      { text: "Species", name: "Species", value: 1 },
    ]);
  });

  it("falls back to an empty option list when no metrics are supplied", () => {
    renderFilters({ options: { ...defaultOptions(), metrics: undefined } });
    expect(captured.Metric.options).toEqual([]);
  });

  it("falls back to an empty threshold target list when none are supplied", () => {
    renderFilters({
      options: { ...defaultOptions(), thresholdFilters: undefined },
    });
    expect(captured.thresholds.metricOptions).toEqual([]);
  });

  it("renders a metric option through the disabled-tooltip menu option", () => {
    renderFilters();
    const rendered = captured.Metric.renderOption(
      {},
      { name: "NT Z Score", value: "NT.zscore", disabled: true },
    );
    render(rendered);
    expect(screen.getByTestId("menu-option").textContent).toBe("NT Z Score");
  });
});

describe("SamplesHeatmapFilters scale select", () => {
  it("indexes the scale options by position and names them back", () => {
    renderFilters();
    const scale = captured.Scale;
    expect(scale.options).toEqual([
      { name: "Log", value: 0 },
      { name: "Lin", value: 1 },
    ]);
    expect(scale.customValueToNameFunction(1, scale.options)).toBe("Lin");
    expect(scale.customValueToNameFunction(0, scale.options)).toBe("Log");
  });
});

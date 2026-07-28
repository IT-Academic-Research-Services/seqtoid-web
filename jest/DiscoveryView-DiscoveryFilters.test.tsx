// Coverage: app/assets/src/components/views/DiscoveryView/components/DiscoveryFilters/DiscoveryFilters.tsx
//
// DiscoveryFilters owns the filter sidebar state machine: it mirrors props into
// state, decides which filters a workflow disables, renders the removable tags
// for every selected value and notifies the parent on each change. The four
// filter widgets are stubbed (they are dropdown-heavy and tested separately)
// so the assertions land on the state/notify/tag logic in this file, including
// the disabled-per-workflow branches and every tag removal path.
import { act, fireEvent, render, screen } from "@testing-library/react";

const mockTrackEventFromClassComponent = jest.fn();
const mockBaseSingleFilterProps: $TSFixMe[] = [];
const mockBaseMultipleFilterProps: $TSFixMe[] = [];
const mockLocationFilterProps: $TSFixMe[] = [];
const mockTaxonThresholdFilterProps: $TSFixMe[] = [];

jest.mock("~/api/analytics", () => ({
  trackEventFromClassComponent: (...args: $TSFixMe[]) =>
    mockTrackEventFromClassComponent(...args),
}));

jest.mock("~/components/common/filters", () => {
  const ReactLib = require("react");
  return {
    BaseSingleFilter: (props: $TSFixMe) => {
      mockBaseSingleFilterProps.push(props);
      return ReactLib.createElement(
        "button",
        {
          "data-testid": `single-filter-${props.label}`,
          "data-value": String(props.value),
          onClick: () => props.onChange("picked"),
        },
        props.label,
      );
    },
    BaseMultipleFilter: (props: $TSFixMe) => {
      mockBaseMultipleFilterProps.push(props);
      return ReactLib.createElement(
        "button",
        {
          "data-testid": `multi-filter-${props.label}`,
          "data-selected": JSON.stringify(props.selected),
          onClick: () => props.onChange(["a", "b"]),
        },
        props.label,
      );
    },
    LocationFilter: (props: $TSFixMe) => {
      mockLocationFilterProps.push(props);
      return ReactLib.createElement(
        "button",
        {
          "data-testid": "location-filter",
          "data-selected": JSON.stringify(props.selected),
          onClick: () => props.onChange(["USA"]),
        },
        props.label,
      );
    },
  };
});

jest.mock("~/components/common/filters/TaxonThresholdFilter", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) => {
      mockTaxonThresholdFilterProps.push(props);
      return ReactLib.createElement("button", {
        "data-testid": "taxon-threshold-filter",
        "data-disabled": String(props.disabled),
        "data-thresholdenabled": String(props.thresholdFilterEnabled),
      });
    },
  };
});

import { WorkflowType } from "~/components/utils/workflows";
import { DiscoveryFilters } from "~/components/views/DiscoveryView/components/DiscoveryFilters/DiscoveryFilters";
import { GlobalContext } from "~/globalContext/reducer";

const contextValue = { discoveryProjectIds: [11, 12] } as $TSFixMe;

const renderFilters = (props: $TSFixMe = {}) => {
  const onFilterChange = props.onFilterChange || jest.fn();
  const utils = render(
    <GlobalContext.Provider value={contextValue}>
      <DiscoveryFilters
        currentTab="samples"
        workflow={WorkflowType.SHORT_READ_MNGS}
        domain="my_data"
        onFilterChange={onFilterChange}
        {...props}
      />
    </GlobalContext.Provider>,
  );
  return { ...utils, onFilterChange };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockBaseSingleFilterProps.length = 0;
  mockBaseMultipleFilterProps.length = 0;
  mockLocationFilterProps.length = 0;
  mockTaxonThresholdFilterProps.length = 0;
});

describe("DiscoveryFilters layout", () => {
  it("renders the taxon, location, timeframe, visibility, host and sample-type filters", () => {
    renderFilters();
    expect(screen.getByTestId("taxon-threshold-filter")).toBeTruthy();
    expect(screen.getByTestId("location-filter")).toBeTruthy();
    expect(screen.getByTestId("single-filter-Timeframe")).toBeTruthy();
    expect(screen.getByTestId("single-filter-Visibility")).toBeTruthy();
    expect(screen.getByTestId("multi-filter-Host")).toBeTruthy();
    expect(screen.getByTestId("multi-filter-Sample Type")).toBeTruthy();
    expect(screen.getByText("Annotation")).toBeTruthy();
  });

  it("hides the taxon, annotation, location and visibility filters on snapshot views", () => {
    renderFilters({ domain: "snapshot" });
    expect(screen.queryByTestId("taxon-threshold-filter")).toBeNull();
    expect(screen.queryByTestId("location-filter")).toBeNull();
    expect(screen.queryByText("Annotation")).toBeNull();
    expect(screen.queryByTestId("single-filter-Visibility")).toBeNull();
    // The timeframe / host / sample type filters survive.
    expect(screen.getByTestId("single-filter-Timeframe")).toBeTruthy();
    expect(screen.getByTestId("multi-filter-Host")).toBeTruthy();
  });

  it("passes null selections through when the option list is empty", () => {
    renderFilters();
    expect(
      screen.getByTestId("multi-filter-Host").getAttribute("data-selected"),
    ).toBe("null");
    expect(
      screen.getByTestId("single-filter-Timeframe").getAttribute("data-value"),
    ).toBe("null");
    expect(
      screen.getByTestId("location-filter").getAttribute("data-selected"),
    ).toBe("null");
  });

  it("passes the current selection through once options exist", () => {
    renderFilters({
      host: [{ value: 1, text: "Human" }],
      hostSelected: [1],
      time: [{ value: "1_week", text: "Last week" }],
      timeSelected: "1_week",
      locationV2: [{ value: "USA", text: "USA", count: 1, parents: [] }],
      locationV2Selected: ["USA"],
    });
    expect(
      screen.getByTestId("multi-filter-Host").getAttribute("data-selected"),
    ).toBe("[1]");
    expect(
      screen.getByTestId("single-filter-Timeframe").getAttribute("data-value"),
    ).toBe("1_week");
    expect(
      screen.getByTestId("location-filter").getAttribute("data-selected"),
    ).toBe('["USA"]');
  });
});

describe("DiscoveryFilters per-workflow availability", () => {
  it("enables both taxon and threshold filtering for short read mNGS", () => {
    renderFilters({ workflow: WorkflowType.SHORT_READ_MNGS });
    const filter = screen.getByTestId("taxon-threshold-filter");
    expect(filter.getAttribute("data-disabled")).toBe("false");
    expect(filter.getAttribute("data-thresholdenabled")).toBe("true");
  });

  it("keeps the taxon filter but disables thresholds for consensus genome", () => {
    renderFilters({ workflow: WorkflowType.CONSENSUS_GENOME });
    const filter = screen.getByTestId("taxon-threshold-filter");
    expect(filter.getAttribute("data-disabled")).toBe("false");
    expect(filter.getAttribute("data-thresholdenabled")).toBe("false");
  });

  it.each([
    [WorkflowType.AMR],
    [WorkflowType.BENCHMARK],
    [WorkflowType.LONG_READ_MNGS],
  ])("disables the taxon filter for %s", workflow => {
    renderFilters({ workflow });
    expect(
      screen
        .getByTestId("taxon-threshold-filter")
        .getAttribute("data-disabled"),
    ).toBe("true");
  });

  it("does not disable anything outside the samples tab", () => {
    renderFilters({ currentTab: "projects", workflow: WorkflowType.AMR });
    expect(
      screen
        .getByTestId("taxon-threshold-filter")
        .getAttribute("data-disabled"),
    ).toBe("false");
  });
});

describe("DiscoveryFilters change notification", () => {
  it("notifies with the full selected-filter set and tracks the change", () => {
    const onFilterChange = jest.fn();
    renderFilters({
      onFilterChange,
      host: [{ value: 1, text: "Human" }],
    });

    fireEvent.click(screen.getByTestId("multi-filter-Host"));

    expect(onFilterChange).toHaveBeenCalledTimes(1);
    const { selectedFilters, onFilterChangeCallback } =
      onFilterChange.mock.calls[0][0];
    expect(selectedFilters.hostSelected).toEqual(["a", "b"]);
    expect(Object.keys(selectedFilters)).toEqual(
      expect.arrayContaining([
        "annotationsSelected",
        "hostSelected",
        "locationSelected",
        "taxonSelected",
        "taxonThresholdsSelected",
        "timeSelected",
        "tissueSelected",
        "visibilitySelected",
      ]),
    );
    expect(onFilterChangeCallback).toBeNull();
    expect(mockTrackEventFromClassComponent).toHaveBeenCalledWith(
      { projectIds: [11, 12] },
      "DiscoveryFilters_hostselected_changed",
      { selectedKey: ["a", "b"] },
    );
  });

  it("notifies for the timeframe, visibility, sample type and location filters too", () => {
    const onFilterChange = jest.fn();
    renderFilters({
      onFilterChange,
      time: [{ value: "1_week", text: "Last week" }],
      visibility: [{ value: "public", text: "Public" }],
      tissue: [{ value: "csf", text: "CSF" }],
      locationV2: [{ value: "USA", text: "USA", count: 1, parents: [] }],
    });

    fireEvent.click(screen.getByTestId("single-filter-Timeframe"));
    fireEvent.click(screen.getByTestId("single-filter-Visibility"));
    fireEvent.click(screen.getByTestId("multi-filter-Sample Type"));
    fireEvent.click(screen.getByTestId("location-filter"));

    expect(onFilterChange).toHaveBeenCalledTimes(4);
    const keys = mockTrackEventFromClassComponent.mock.calls.map(c => c[1]);
    expect(keys).toEqual([
      "DiscoveryFilters_timeselected_changed",
      "DiscoveryFilters_visibilityselected_changed",
      "DiscoveryFilters_tissueselected_changed",
      "DiscoveryFilters_locationv2selected_changed",
    ]);
  });

  it("still tracks the change when no onFilterChange handler is given", () => {
    render(
      <GlobalContext.Provider value={contextValue}>
        <DiscoveryFilters
          currentTab="samples"
          workflow={WorkflowType.SHORT_READ_MNGS}
          domain="my_data"
          host={[{ value: 1, text: "Human" }]}
        />
      </GlobalContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("multi-filter-Host"));
    expect(mockTrackEventFromClassComponent).toHaveBeenCalled();
  });
});

describe("DiscoveryFilters tags", () => {
  it("renders a tag per selected value, resolving labels from the option list", () => {
    renderFilters({
      host: [
        { value: 1, text: "Human" },
        { value: 2, text: "Mosquito" },
      ],
      hostSelected: [1, 2],
    });
    const tags = screen.getAllByTestId("filter-tag").map(t => t.textContent);
    expect(tags).toEqual(["Human", "Mosquito"]);
  });

  it("falls back to the raw value when the option list has no match", () => {
    renderFilters({ host: [], hostSelected: [7] });
    expect(screen.getByTestId("filter-tag").textContent).toBe("7");
  });

  it("wraps a single non-array selection into one tag", () => {
    renderFilters({
      time: [{ value: "1_week", text: "Last week" }],
      timeSelected: "1_week",
    });
    expect(screen.getByTestId("filter-tag").textContent).toBe("Last week");
  });

  it("renders no tags when nothing is selected", () => {
    renderFilters();
    expect(screen.queryAllByTestId("filter-tag")).toHaveLength(0);
  });

  it("removes the clicked tag and notifies with the remaining values", () => {
    const onFilterChange = jest.fn();
    renderFilters({
      onFilterChange,
      host: [
        { value: 1, text: "Human" },
        { value: 2, text: "Mosquito" },
      ],
      hostSelected: [1, 2],
    });
    const closeIcons = screen
      .getAllByTestId("filter-tag")
      .map(tag => tag.querySelector("svg") as Element);
    fireEvent.click(closeIcons[0]);

    expect(
      onFilterChange.mock.calls[0][0].selectedFilters.hostSelected,
    ).toEqual([2]);
  });
});

describe("DiscoveryFilters annotation tags", () => {
  it("renders one tag per selected annotation and removes it on close", () => {
    const onFilterChange = jest.fn();
    renderFilters({
      onFilterChange,
      annotationsSelected: [{ name: "Hit" }, { name: "Inconclusive" }],
    });
    const tags = screen.getAllByTestId("filter-tag").map(t => t.textContent);
    expect(tags).toEqual(["Hit", "Inconclusive"]);

    fireEvent.click(
      screen.getAllByTestId("filter-tag")[0].querySelector("svg") as Element,
    );
    expect(
      onFilterChange.mock.calls[0][0].selectedFilters.annotationsSelected,
    ).toEqual([{ name: "Inconclusive" }]);
  });

  it("renders no annotation tags when none are selected", () => {
    renderFilters({ annotationsSelected: [] });
    expect(screen.queryAllByTestId("filter-tag")).toHaveLength(0);
  });

  it("hides the annotation tags when the workflow disables annotations", () => {
    renderFilters({
      workflow: WorkflowType.AMR,
      annotationsSelected: [{ name: "Hit" }],
    });
    expect(screen.queryAllByTestId("filter-tag")).toHaveLength(0);
  });
});

describe("DiscoveryFilters taxon tags", () => {
  const taxa = [
    { id: 1, level: "species", name: "Klebsiella" },
    { id: 2, level: "genus", name: "Rhinovirus" },
  ];

  it("renders the 'Has at least one' descriptor when thresholds are available", () => {
    renderFilters({ taxonSelected: taxa });
    expect(screen.getByText("Has at least one:")).toBeTruthy();
    expect(screen.getAllByTestId("filter-tag").map(t => t.textContent)).toEqual(
      ["Klebsiella", "Rhinovirus"],
    );
  });

  it("omits the descriptor when the workflow disables thresholds", () => {
    renderFilters({
      workflow: WorkflowType.CONSENSUS_GENOME,
      taxonSelected: taxa,
    });
    expect(screen.queryByText("Has at least one:")).toBeNull();
    expect(screen.getAllByTestId("filter-tag")).toHaveLength(2);
  });

  it("removes a taxon tag and keeps the remaining taxa", () => {
    const onFilterChange = jest.fn();
    renderFilters({ onFilterChange, taxonSelected: taxa });
    fireEvent.click(
      screen.getAllByTestId("filter-tag")[0].querySelector("svg") as Element,
    );
    const { selectedFilters } = onFilterChange.mock.calls[0][0];
    expect(selectedFilters.taxonSelected).toEqual([taxa[1]]);
  });

  it("clears the threshold filters when the last taxon is removed", () => {
    const onFilterChange = jest.fn();
    renderFilters({
      onFilterChange,
      taxonSelected: [taxa[0]],
      taxonThresholdsSelected: [
        {
          metric: "nt_zscore",
          metricDisplay: "NT Z Score",
          operator: ">=",
          value: "2",
        },
      ] as $TSFixMe,
    });
    fireEvent.click(
      screen.getAllByTestId("filter-tag")[0].querySelector("svg") as Element,
    );
    const { selectedFilters } = onFilterChange.mock.calls[0][0];
    expect(selectedFilters.taxonSelected).toEqual([]);
  });

  it("renders no taxon tags when no taxa are selected", () => {
    renderFilters({ taxonSelected: [] });
    expect(screen.queryByText("Has at least one:")).toBeNull();
  });
});

describe("DiscoveryFilters threshold tags", () => {
  const thresholds = [
    {
      metric: "nt_zscore",
      metricDisplay: "NT Z Score",
      operator: ">=",
      value: "2",
    },
    {
      metric: "nr_rpm",
      metricDisplay: "NR rPM",
      operator: ">=",
      value: "5",
    },
  ] as $TSFixMe;

  it("renders the 'Meets all' descriptor and one tag per threshold", () => {
    renderFilters({ taxonThresholdsSelected: thresholds });
    expect(screen.getByText("Meets all:")).toBeTruthy();
    expect(screen.getByText("NT Z Score >= 2")).toBeTruthy();
    expect(screen.getByText("NR rPM >= 5")).toBeTruthy();
  });

  it("removes a threshold tag and notifies with the rest", () => {
    const onFilterChange = jest.fn();
    renderFilters({ onFilterChange, taxonThresholdsSelected: thresholds });
    const tag = screen.getByText("NT Z Score >= 2")
      .parentElement as HTMLElement;
    fireEvent.click(tag.querySelector("svg") as Element);

    const { selectedFilters } = onFilterChange.mock.calls[0][0];
    expect(selectedFilters.taxonThresholdsSelected).toEqual([thresholds[1]]);
  });

  it("renders no threshold tags when the workflow disables thresholds", () => {
    renderFilters({
      workflow: WorkflowType.CONSENSUS_GENOME,
      taxonThresholdsSelected: thresholds,
    });
    expect(screen.queryByText("Meets all:")).toBeNull();
  });

  it("renders nothing when the threshold list is empty", () => {
    renderFilters({ taxonThresholdsSelected: [] });
    expect(screen.queryByText("Meets all:")).toBeNull();
  });
});

describe("DiscoveryFilters taxon + threshold apply", () => {
  it("keeps only valid thresholds and tracks both changed keys", () => {
    const onFilterChange = jest.fn();
    renderFilters({ onFilterChange });
    const { onFilterApply } = mockTaxonThresholdFilterProps[0];

    const validThreshold = {
      metric: "nt_zscore",
      metricDisplay: "NT Z Score",
      operator: ">=",
      value: "2",
    };
    const invalidThreshold = {
      metric: "",
      metricDisplay: "",
      operator: ">=",
      value: "",
    };

    act(() => {
      onFilterApply(
        [{ id: 1, level: "species", name: "Klebsiella" }],
        [validThreshold, invalidThreshold],
      );
    });

    const { selectedFilters } = onFilterChange.mock.calls[0][0];
    expect(selectedFilters.taxonSelected).toEqual([
      { id: 1, level: "species", name: "Klebsiella" },
    ]);
    expect(selectedFilters.taxonThresholdsSelected).toEqual([validThreshold]);

    const trackedKeys = mockTrackEventFromClassComponent.mock.calls.map(
      c => c[1],
    );
    expect(trackedKeys).toEqual([
      "DiscoveryFilters_taxonselected_changed",
      "DiscoveryFilters_taxonthresholdsselected_changed",
    ]);
  });

  it("does not track unchanged selections", () => {
    const taxa = [{ id: 1, level: "species", name: "Klebsiella" }];
    const onFilterChange = jest.fn();
    renderFilters({ onFilterChange, taxonSelected: taxa });
    const { onFilterApply } = mockTaxonThresholdFilterProps[0];

    // Same taxa, no thresholds on either side -> nothing changed for taxa.
    act(() => {
      onFilterApply(
        [{ id: 1, level: "species", name: "Klebsiella" }],
        undefined,
      );
    });

    const trackedKeys = mockTrackEventFromClassComponent.mock.calls.map(
      c => c[1],
    );
    expect(trackedKeys).not.toContain("DiscoveryFilters_taxonselected_changed");
    expect(onFilterChange).toHaveBeenCalled();
  });
});

// Branch coverage for
// app/assets/src/components/views/DiscoveryView/components/DiscoveryFilters/DiscoveryFilters.tsx
//
// The main DiscoveryFilters spec always selects array-shaped values with a
// `value` key, and never drives the SDS annotation Dropdown (it is rendered by
// the real @czi-sds component there). That leaves these conditionals unhit:
//
//   * `handleRemoveTag({ ..., valueToRemove = "" })` -- the defaulted argument,
//     reached when the tag being closed carries no `value`
//   * `if (Array.isArray(this.state[selectedKey]))` -- the else path, taken for
//     single-value filters such as Timeframe
//   * `option.text ? option : find(...)` -- the consequent, for selections that
//     already arrive as { text, value } hashes
//   * the annotation Dropdown's `selectedValue !== state` guard (both outcomes),
//     which exists because SDS fires onChange even when nothing changed
//   * `value={annotationsSelected || []}` -- the empty-array fallback
import { fireEvent, render, screen } from "@testing-library/react";

const mockTrackEventFromClassComponent = jest.fn();

jest.mock("~/api/analytics", () => ({
  trackEventFromClassComponent: (...args: $TSFixMe[]) =>
    mockTrackEventFromClassComponent(...args),
}));

jest.mock("~/components/common/filters", () => {
  const ReactLib = require("react");
  return {
    BaseSingleFilter: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": `single-filter-${props.label}`,
      }),
    BaseMultipleFilter: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": `multi-filter-${props.label}`,
      }),
    LocationFilter: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "location-filter",
        "data-selected": JSON.stringify(props.selected),
      }),
  };
});

jest.mock("~/components/common/filters/TaxonThresholdFilter", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: () =>
      ReactLib.createElement("button", {
        "data-testid": "taxon-threshold-filter",
      }),
  };
});

// The annotation filter is an SDS Dropdown; stub it so its onChange can be
// fired with both a new value and the value it already has.
let mockDropdownProps: $TSFixMe = null;
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    Dropdown: (props: $TSFixMe) => {
      mockDropdownProps = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "annotation-dropdown" },
        props.label,
        ReactLib.createElement("button", {
          "data-testid": "annotation-change",
          onClick: () => props.onChange([{ name: "Inconclusive" }]),
        }),
        ReactLib.createElement("button", {
          "data-testid": "annotation-nochange",
          // SDS re-fires onChange with the identical value.
          onClick: () => props.onChange(props.value),
        }),
      );
    },
    Tooltip: (props: $TSFixMe) =>
      ReactLib.createElement("div", null, props.children),
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
        {...props}
        onFilterChange={onFilterChange}
      />
    </GlobalContext.Provider>,
  );
  return { ...utils, onFilterChange };
};

const closeTag = (index = 0) =>
  fireEvent.click(
    screen.getAllByTestId("filter-tag")[index].querySelector("svg") as Element,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockDropdownProps = null;
});

describe("DiscoveryFilters tag shapes", () => {
  it("renders a pre-formatted { text, value } selection without looking it up", () => {
    // No matching entry in the `locationV2` options list: the hash carries its
    // own display text, so no lookup is needed.
    renderFilters({
      locationV2: [{ value: "other", text: "Other", count: 1, parents: [] }],
      locationV2Selected: [{ text: "San Francisco", value: "sf" }] as $TSFixMe,
    });

    expect(screen.getByTestId("filter-tag").textContent).toBe("San Francisco");
  });

  it("removes nothing when the closed tag carries no value", () => {
    // valueToRemove falls back to "" -- no selected entry equals "", so the
    // selection survives the removal untouched.
    const { onFilterChange } = renderFilters({
      locationV2Selected: [{ text: "Unlabelled place" }] as $TSFixMe,
    });

    expect(screen.getByTestId("filter-tag").textContent).toBe(
      "Unlabelled place",
    );
    closeTag();

    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(
      onFilterChange.mock.calls[0][0].selectedFilters.locationV2Selected,
    ).toEqual([{ text: "Unlabelled place" }]);
  });

  it("clears a single-value filter outright when its tag is closed", () => {
    // timeSelected is a plain string, not an array, so there is nothing to
    // filter: the whole selection is dropped.
    const { onFilterChange } = renderFilters({
      time: [{ value: "1_week", text: "Last week" }],
      timeSelected: "1_week",
    });

    expect(screen.getByTestId("filter-tag").textContent).toBe("Last week");
    closeTag();

    expect(
      onFilterChange.mock.calls[0][0].selectedFilters.timeSelected,
    ).toBeNull();
  });
});

describe("DiscoveryFilters annotation dropdown", () => {
  it("passes an empty selection to the dropdown when nothing is selected", () => {
    renderFilters();
    expect(mockDropdownProps.value).toEqual([]);
  });

  it("ignores an onChange that repeats the current selection", () => {
    const annotationsSelected = [{ name: "Hit" }] as $TSFixMe;
    const { onFilterChange } = renderFilters({ annotationsSelected });

    expect(mockDropdownProps.value).toEqual(annotationsSelected);
    fireEvent.click(screen.getByTestId("annotation-nochange"));

    // Nothing changed, so the parent is never notified.
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(mockTrackEventFromClassComponent).not.toHaveBeenCalled();
  });

  it("applies an onChange that carries a different selection", () => {
    const { onFilterChange } = renderFilters({
      annotationsSelected: [{ name: "Hit" }] as $TSFixMe,
    });

    fireEvent.click(screen.getByTestId("annotation-change"));

    expect(
      onFilterChange.mock.calls[0][0].selectedFilters.annotationsSelected,
    ).toEqual([{ name: "Inconclusive" }]);
    expect(mockTrackEventFromClassComponent).toHaveBeenCalledWith(
      expect.anything(),
      "DiscoveryFilters_annotationsselected_changed",
      expect.anything(),
    );
  });
});

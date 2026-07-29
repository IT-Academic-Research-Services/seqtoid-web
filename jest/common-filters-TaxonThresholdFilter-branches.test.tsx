// Branch coverage for app/assets/src/components/common/filters/TaxonThresholdFilter.tsx
//
// The main TaxonThresholdFilter spec always passes every prop and only ever
// opens the popper once, so four conditionals in this component are never
// exercised:
//
//   * the `disabled = false` default parameter (prop omitted)
//   * the `thresholdFilterEnabled = true` default parameter (prop omitted)
//   * `setAnchorEl(anchorEl ? null : event.currentTarget)` -- the "already open,
//     so close" arm
//   * `...(Array.isArray(existingThresholds) ? existingThresholds : [])` in
//     handleAddThresholdItem -- the fallback for a non-array threshold state
//
// The surrounding pieces (SDS button/popper, filter trigger, taxon filter,
// threshold list, threshold metric constants) are stubbed so each assertion
// lands on this component's own state machine.
import { fireEvent, render, screen } from "@testing-library/react";
import TaxonThresholdFilter from "~/components/common/filters/TaxonThresholdFilter";

jest.mock("~/components/views/SampleView/utils", () => ({
  NON_BACKGROUND_DEPENDENT_SHORT_READS_THRESHOLDS: [
    { value: "nt_zscore", text: "NT Z Score" },
    { value: "nt_rpm", text: "NT rPM" },
  ],
}));

jest.mock("~/components/common/filters/FilterTrigger", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement(
        "button",
        {
          "data-testid": "filter-trigger",
          disabled: props.disabled,
          onClick: props.onClick,
        },
        props.label,
      ),
  };
});

jest.mock("~/components/common/filters/TaxonFilterSDS", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement("div", {
        "data-testid": "taxon-filter-sds",
        "data-selected": JSON.stringify(props.selectedTaxa),
      }),
  };
});

let mockThresholdListProps: $TSFixMe = null;
jest.mock("~/components/ui/controls/dropdowns", () => {
  const ReactLib = require("react");
  return {
    ThresholdFilterList: (props: $TSFixMe) => {
      mockThresholdListProps = props;
      return ReactLib.createElement(
        "div",
        {
          "data-testid": "threshold-list",
          "data-count": (props.thresholds || []).length,
        },
        ReactLib.createElement("button", {
          "data-testid": "add-threshold",
          onClick: props.onAddThreshold,
        }),
      );
    },
  };
});

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    Button: (props: $TSFixMe) =>
      ReactLib.createElement(
        "button",
        {
          "data-testid": `sds-button-${props.sdsType}`,
          disabled: props.disabled,
          onClick: props.onClick,
        },
        props.children,
      ),
    DropdownPopper: (props: $TSFixMe) =>
      props.open
        ? ReactLib.createElement(
            "div",
            { "data-testid": "popper" },
            props.children,
          )
        : null,
  };
});

const trigger = () => screen.getByTestId("filter-trigger") as HTMLButtonElement;

describe("TaxonThresholdFilter defaulted props", () => {
  beforeEach(() => {
    mockThresholdListProps = null;
  });

  it("is enabled and shows the threshold list when neither optional prop is passed", () => {
    // `disabled` and `thresholdFilterEnabled` are omitted entirely, so the
    // component's own defaults (false / true) have to supply them.
    const props = {
      domain: "my_data",
      selectedOptions: [],
      selectedThresholds: [],
      onFilterApply: jest.fn(),
    } as $TSFixMe;
    render(<TaxonThresholdFilter {...props} />);

    expect(trigger().disabled).toBe(false);

    fireEvent.click(trigger());
    // thresholdFilterEnabled defaulted to true -> the list renders.
    expect(screen.getByTestId("threshold-list")).toBeTruthy();
  });
});

describe("TaxonThresholdFilter popper toggle", () => {
  it("closes the popper when the trigger is clicked a second time", () => {
    const props = {
      domain: "my_data",
      selectedOptions: [],
      selectedThresholds: [],
      onFilterApply: jest.fn(),
      disabled: false,
      thresholdFilterEnabled: true,
    } as $TSFixMe;
    render(<TaxonThresholdFilter {...props} />);

    fireEvent.click(trigger());
    expect(screen.getByTestId("popper")).toBeTruthy();

    // anchorEl is already set, so the click clears it instead of re-anchoring.
    fireEvent.click(trigger());
    expect(screen.queryByTestId("popper")).toBeNull();

    // ...and a third click reopens it.
    fireEvent.click(trigger());
    expect(screen.getByTestId("popper")).toBeTruthy();
  });
});

describe("TaxonThresholdFilter add-threshold fallback", () => {
  beforeEach(() => {
    mockThresholdListProps = null;
  });

  it("starts a fresh list when the current threshold state is not an array", () => {
    // A caller that hands down a non-array (e.g. nothing parsed out of the URL
    // filters) would blow up the spread; the Array.isArray guard falls back to
    // an empty list instead.
    const props = {
      domain: "my_data",
      selectedOptions: [],
      selectedThresholds: undefined,
      onFilterApply: jest.fn(),
      disabled: false,
      thresholdFilterEnabled: true,
    } as $TSFixMe;
    render(<TaxonThresholdFilter {...props} />);

    fireEvent.click(trigger());
    expect(mockThresholdListProps.thresholds).toBeUndefined();
    // The threshold descriptor is hidden because there is no length to read.
    expect(screen.queryByText("Meets all of these thresholds:")).toBeNull();

    fireEvent.click(screen.getByTestId("add-threshold"));

    expect(mockThresholdListProps.thresholds).toHaveLength(1);
    expect(mockThresholdListProps.thresholds[0]).toEqual({
      metric: "nt_zscore",
      metricDisplay: "NT Z Score",
      operator: ">=",
      value: "",
    });
  });
});

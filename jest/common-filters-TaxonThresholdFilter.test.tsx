// Coverage: app/assets/src/components/common/filters/TaxonThresholdFilter.tsx
//
// TaxonThresholdFilter is the popover that combines a taxon multi-select with a
// list of metric thresholds. Its logic: open/close the popper from the filter
// trigger; mirror the selected-options and selected-thresholds props into local
// state; track whether the user has modified either the taxa or the thresholds
// (which, together with a non-empty taxon selection, gates the Apply button);
// add/change/remove threshold rows; and apply (notify the parent) or cancel
// (revert to props). The taxon filter, threshold list, filter trigger, popper,
// button, and the shared threshold-metric constant are all stubbed so the
// assertions land on this component's own state machine.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import TaxonThresholdFilter from "~/components/common/filters/TaxonThresholdFilter";

const _React: typeof React = React;

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

let mockTaxonHandleChange: ((taxa: $TSFixMe) => void) | null = null;
jest.mock("~/components/common/filters/TaxonFilterSDS", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) => {
      mockTaxonHandleChange = props.handleChange;
      return ReactLib.createElement("div", {
        "data-testid": "taxon-filter-sds",
        "data-selected": JSON.stringify(props.selectedTaxa),
      });
    },
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
        ReactLib.createElement("button", {
          "data-testid": "change-threshold",
          onClick: () =>
            props.onChangeThreshold(0, {
              metric: "nt_zscore",
              metricDisplay: "NT Z Score",
              operator: ">=",
              value: "5",
            }),
        }),
        ReactLib.createElement("button", {
          "data-testid": "remove-threshold",
          onClick: () => props.onRemoveThreshold(0),
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

const baseProps = {
  domain: "my_data",
  selectedOptions: [] as $TSFixMe,
  selectedThresholds: [] as $TSFixMe,
  onFilterApply: jest.fn(),
  disabled: false,
  thresholdFilterEnabled: true,
};

const open = () => fireEvent.click(screen.getByTestId("filter-trigger"));

describe("TaxonThresholdFilter", () => {
  beforeEach(() => {
    mockTaxonHandleChange = null;
    mockThresholdListProps = null;
  });

  it("keeps the popper closed until the trigger is clicked", () => {
    render(<TaxonThresholdFilter {...baseProps} onFilterApply={jest.fn()} />);
    expect(screen.queryByTestId("popper")).toBeNull();
    open();
    expect(screen.getByTestId("popper")).toBeTruthy();
    expect(screen.getByText("Taxon Filter")).toBeTruthy();
  });

  it("disables Apply until the user modifies the filters", () => {
    render(<TaxonThresholdFilter {...baseProps} onFilterApply={jest.fn()} />);
    open();
    expect(
      (screen.getByTestId("sds-button-primary") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("enables Apply once taxa change and forwards the selection on apply", () => {
    const onFilterApply = jest.fn();
    render(
      <TaxonThresholdFilter {...baseProps} onFilterApply={onFilterApply} />,
    );
    open();

    // Simulate the taxon filter reporting a new, different selection.
    fireEvent.click(screen.getByTestId("add-threshold")); // ensure list wired
    React.act(() => {
      mockTaxonHandleChange!([{ id: 7, name: "New taxon", level: "genus" }]);
    });

    const applyBtn = screen.getByTestId(
      "sds-button-primary",
    ) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(false);

    fireEvent.click(applyBtn);
    expect(onFilterApply).toHaveBeenCalledWith(
      [{ id: 7, name: "New taxon", level: "genus" }],
      expect.any(Array),
    );
    // Applying closes the popper.
    expect(screen.queryByTestId("popper")).toBeNull();
  });

  it("adds, changes and removes threshold rows", () => {
    render(<TaxonThresholdFilter {...baseProps} onFilterApply={jest.fn()} />);
    open();

    expect(
      screen.getByTestId("threshold-list").getAttribute("data-count"),
    ).toBe("0");

    fireEvent.click(screen.getByTestId("add-threshold"));
    expect(mockThresholdListProps.thresholds).toHaveLength(1);
    expect(mockThresholdListProps.thresholds[0].metric).toBe("nt_zscore");

    // Changing a threshold to a filled-in value marks the filters modified.
    fireEvent.click(screen.getByTestId("change-threshold"));
    expect(mockThresholdListProps.thresholds[0].value).toBe("5");

    fireEvent.click(screen.getByTestId("remove-threshold"));
    expect(mockThresholdListProps.thresholds).toHaveLength(0);
  });

  it("shows the threshold descriptor only when thresholds are present", () => {
    render(
      <TaxonThresholdFilter
        {...baseProps}
        selectedThresholds={[
          {
            metric: "nt_zscore",
            metricDisplay: "NT Z Score",
            operator: ">=",
            value: "5",
          },
        ]}
        onFilterApply={jest.fn()}
      />,
    );
    open();
    expect(screen.getByText("Meets all of these thresholds:")).toBeTruthy();
  });

  it("hides the threshold list when thresholds are disabled", () => {
    render(
      <TaxonThresholdFilter
        {...baseProps}
        thresholdFilterEnabled={false}
        onFilterApply={jest.fn()}
      />,
    );
    open();
    expect(screen.queryByTestId("threshold-list")).toBeNull();
  });

  it("reverts local state and closes on cancel", () => {
    render(<TaxonThresholdFilter {...baseProps} onFilterApply={jest.fn()} />);
    open();

    React.act(() => {
      mockTaxonHandleChange!([{ id: 7, name: "New taxon", level: "genus" }]);
    });
    // Apply is now enabled...
    expect(
      (screen.getByTestId("sds-button-primary") as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByTestId("sds-button-secondary"));
    // Cancel closes the popper.
    expect(screen.queryByTestId("popper")).toBeNull();

    // Reopening shows the reverted (empty) selection.
    open();
    expect(
      screen.getByTestId("taxon-filter-sds").getAttribute("data-selected"),
    ).toBe("[]");
  });

  it("mirrors later selectedOptions and selectedThresholds props into state", () => {
    const { rerender } = render(
      <TaxonThresholdFilter {...baseProps} onFilterApply={jest.fn()} />,
    );
    open();
    expect(
      screen.getByTestId("taxon-filter-sds").getAttribute("data-selected"),
    ).toBe("[]");

    rerender(
      <TaxonThresholdFilter
        {...baseProps}
        selectedOptions={[{ id: 3, name: "Mirrored", level: "genus" }]}
        onFilterApply={jest.fn()}
      />,
    );
    expect(
      screen.getByTestId("taxon-filter-sds").getAttribute("data-selected"),
    ).toContain("Mirrored");
  });
});

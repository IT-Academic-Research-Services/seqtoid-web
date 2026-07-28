// Coverage: app/assets/src/components/common/filters/ThresholdFilterSDS/ThresholdFilterSDS.tsx
//
// ThresholdFilterSDS keeps a draft copy of the parent's thresholds, decides
// whether the Apply button is enabled (checkIfThresholdFiltersWereModified),
// and emits the applied/removed thresholds via onApply. The SDS chrome
// (InputDropdown / DropdownPopper / Button) and the ThresholdFilterList +
// ThresholdFilterTag children are stubbed so assertions land on this file's
// add/change/remove/apply/cancel logic and the tag-removal path.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const _React: typeof React = React;

// --- SDS chrome stubs ------------------------------------------------------
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    InputDropdown: (props: $TSFixMe) =>
      ReactLib.createElement(
        "button",
        {
          "data-testid": "input-dropdown",
          disabled: props.disabled,
          onClick: props.onClick,
        },
        "Thresholds",
      ),
    DropdownPopper: (props: $TSFixMe) =>
      props.open
        ? ReactLib.createElement(
            "div",
            { "data-testid": "popper" },
            props.children,
          )
        : null,
    Button: (props: $TSFixMe) =>
      ReactLib.createElement(
        "button",
        {
          "data-testid": props["data-testid"] || "sds-button",
          disabled: props.disabled,
          onClick: props.onClick,
        },
        props.children,
      ),
  };
});

// --- ThresholdFilterList stub: exposes add/change/remove hooks -------------
jest.mock("~/components/ui/controls/dropdowns", () => {
  const ReactLib = require("react");
  return {
    ThresholdFilterList: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "threshold-list" },
        ReactLib.createElement(
          "div",
          { "data-testid": "threshold-count" },
          String(props.thresholds.length),
        ),
        ReactLib.createElement(
          "button",
          { "data-testid": "add-threshold", onClick: props.onAddThreshold },
          "add",
        ),
        ReactLib.createElement(
          "button",
          {
            "data-testid": "change-threshold",
            onClick: () =>
              props.onChangeThreshold(0, {
                metric: "nt_zscore",
                metricDisplay: "NT Z Score",
                operator: ">=",
                value: "5",
              }),
          },
          "change",
        ),
        ReactLib.createElement(
          "button",
          {
            "data-testid": "remove-threshold",
            onClick: () => props.onRemoveThreshold(0),
          },
          "remove",
        ),
      ),
  };
});

// --- ThresholdFilterTag stub: exposes onClose -----------------------------
jest.mock("~/components/common/ThresholdFilterTag", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement(
        "button",
        {
          "data-testid": "tag",
          "data-metric": props.threshold.metric,
          onClick: props.onClose,
        },
        `${props.threshold.metricDisplay} ${props.threshold.value}`,
      ),
  };
});

import { ThresholdFilterSDS } from "~/components/common/filters/ThresholdFilterSDS/ThresholdFilterSDS";

const METRIC_OPTIONS = [
  { text: "NT Z Score", value: "nt_zscore" },
  { text: "NT rPM", value: "nt_rpm" },
] as $TSFixMe;

const threshold = (over = {}) => ({
  metric: "nt_zscore",
  metricDisplay: "NT Z Score",
  operator: ">=",
  value: "2",
  ...over,
});

const renderSDS = (over: $TSFixMe = {}) => {
  const onApply = jest.fn();
  const utils = render(
    <ThresholdFilterSDS
      selectedThresholds={over.selectedThresholds ?? [threshold()]}
      onApply={onApply}
      metricOptions={METRIC_OPTIONS}
      disabled={over.disabled ?? false}
      shouldShowTags={over.shouldShowTags}
    />,
  );
  return { onApply, ...utils };
};

describe("ThresholdFilterSDS", () => {
  it("renders a removable tag per selected threshold and calls onApply on close", () => {
    const { onApply } = renderSDS({
      selectedThresholds: [
        threshold(),
        threshold({ metric: "nt_rpm", value: "10" }),
      ],
    });
    const tags = screen.getAllByTestId("tag");
    expect(tags.length).toBe(2);
    fireEvent.click(tags[0]);
    // Removing tag 0 applies the remaining threshold only.
    expect(onApply).toHaveBeenCalledWith([
      threshold({ metric: "nt_rpm", value: "10" }),
    ]);
  });

  it("hides the tag list when shouldShowTags is false", () => {
    renderSDS({ shouldShowTags: false });
    expect(screen.queryByTestId("tag")).toBeNull();
  });

  it("does not open the popper until the input dropdown is clicked", () => {
    renderSDS();
    expect(screen.queryByTestId("popper")).toBeNull();
    fireEvent.click(screen.getByTestId("input-dropdown"));
    expect(screen.getByTestId("popper")).toBeTruthy();
  });

  it("adds a default threshold row when opened with no drafts", () => {
    renderSDS({ selectedThresholds: [] });
    fireEvent.click(screen.getByTestId("input-dropdown"));
    // Opening with an empty draft list auto-adds the first metric row.
    expect(screen.getByTestId("threshold-count").textContent).toBe("1");
    // Adding again grows the list.
    fireEvent.click(screen.getByTestId("add-threshold"));
    expect(screen.getByTestId("threshold-count").textContent).toBe("2");
  });

  it("keeps Apply disabled until a draft threshold is actually modified", () => {
    renderSDS();
    fireEvent.click(screen.getByTestId("input-dropdown"));
    // Draft mirrors the (unchanged) selected thresholds -> not modified.
    expect((screen.getByTestId("apply") as HTMLButtonElement).disabled).toBe(
      true,
    );
    // Editing a threshold value flips hasModifiedFilters on.
    fireEvent.click(screen.getByTestId("change-threshold"));
    expect((screen.getByTestId("apply") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("enables Apply when a threshold is removed (modification via removal)", () => {
    renderSDS();
    fireEvent.click(screen.getByTestId("input-dropdown"));
    fireEvent.click(screen.getByTestId("remove-threshold"));
    expect((screen.getByTestId("apply") as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.getByTestId("threshold-count").textContent).toBe("0");
  });

  it("applies the edited drafts and closes the popper on Apply", () => {
    const { onApply } = renderSDS();
    fireEvent.click(screen.getByTestId("input-dropdown"));
    fireEvent.click(screen.getByTestId("change-threshold"));
    fireEvent.click(screen.getByTestId("apply"));
    expect(onApply).toHaveBeenCalledWith([threshold({ value: "5" })]);
    // Applying closes the popper.
    expect(screen.queryByTestId("popper")).toBeNull();
  });

  it("discards drafts and closes on Cancel without calling onApply", () => {
    const { onApply } = renderSDS();
    fireEvent.click(screen.getByTestId("input-dropdown"));
    fireEvent.click(screen.getByTestId("change-threshold"));
    // Cancel is the secondary button (the one without the apply testid).
    fireEvent.click(screen.getByText("Cancel"));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByTestId("popper")).toBeNull();
  });

  it("keeps the popper closed while disabled even if opened", () => {
    renderSDS({ disabled: true });
    const input = screen.getByTestId("input-dropdown") as HTMLButtonElement;
    expect(input.disabled).toBe(true);
    fireEvent.click(input);
    // open is gated by !disabled, so the popper never appears.
    expect(screen.queryByTestId("popper")).toBeNull();
  });
});

// Coverage for
// app/assets/src/components/ui/controls/dropdowns/ThresholdFilter.tsx
//
// A single threshold row: a metric dropdown, an operator dropdown, a numeric
// value input and a remove control. Every edit rebuilds the whole
// ThresholdFilterData object (carrying the untouched fields) and calls onChange;
// the remove control fires onRemove on click and on Enter. The SDS Dropdown /
// InputText are stubbed with minimal harnesses that expose their onChange so
// each handler (metric / operator / value) and the remove key branches run for
// real; the SDS-format utils run unmocked.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import ThresholdFilter from "~/components/ui/controls/dropdowns/ThresholdFilter";

// Stub the two heavy SDS widgets. Each Dropdown renders a button that invokes
// its onChange with a fixed SDS-format option so handleMetricChange /
// handleOperatorChange execute; InputText renders a plain input.
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    Dropdown: (props: $TSFixMe) =>
      ReactLib.createElement(
        "button",
        {
          "data-testid": props["data-testid"] ?? "operator-dropdown",
          onClick: () =>
            props.onChange(
              props["data-testid"] === "threshold-metric-dropdown"
                ? { value: "nt_zscore", name: "nt_zscore" }
                : { value: ">=", name: ">=" },
            ),
        },
        "dropdown",
      ),
    InputText: (props: $TSFixMe) =>
      ReactLib.createElement("input", {
        "data-testid": "value-input",
        value: props.value,
        onChange: props.onChange,
      }),
  };
});

const _React: typeof React = React;

const METRICS = [
  { text: "NT Z Score", value: "nt_zscore" },
  { text: "NT rPM", value: "nt_rpm" },
];

const baseThreshold = {
  metric: "nt_rpm",
  value: "10",
  operator: ">=" as const,
  metricDisplay: "NT rPM",
};

function renderFilter(overrides: $TSFixMe = {}) {
  const onChange = jest.fn();
  const onRemove = jest.fn();
  render(
    <ThresholdFilter
      threshold={baseThreshold}
      metrics={METRICS as $TSFixMe}
      operators={[">=", "<="] as $TSFixMe}
      onChange={onChange}
      onRemove={onRemove}
      {...overrides}
    />,
  );
  return { onChange, onRemove };
}

describe("ThresholdFilter", () => {
  it("emits a rebuilt threshold with the new metric and its display text", () => {
    const { onChange } = renderFilter();
    fireEvent.click(screen.getByTestId("threshold-metric-dropdown"));
    expect(onChange).toHaveBeenCalledWith({
      metric: "nt_zscore",
      value: "10",
      operator: ">=",
      metricDisplay: "NT Z Score",
    });
  });

  it("emits a rebuilt threshold when the operator changes", () => {
    const { onChange } = renderFilter();
    fireEvent.click(screen.getByTestId("operator-dropdown"));
    expect(onChange).toHaveBeenCalledWith({
      metric: "nt_rpm",
      value: "10",
      operator: ">=",
      metricDisplay: "NT rPM",
    });
  });

  it("emits a rebuilt threshold when the value input changes", () => {
    const { onChange } = renderFilter();
    fireEvent.change(screen.getByTestId("value-input"), {
      target: { value: "55" },
    });
    expect(onChange).toHaveBeenCalledWith({
      metric: "nt_rpm",
      value: "55",
      operator: ">=",
      metricDisplay: "NT rPM",
    });
  });

  // The remove control is the only role=button rendered as a <div> (the two
  // stubbed dropdowns render as <button>).
  const removeControl = () =>
    screen
      .getAllByRole("button")
      .find(el => el.tagName === "DIV") as HTMLElement;

  it("calls onRemove when the remove control is clicked", () => {
    const { onRemove } = renderFilter();
    fireEvent.click(removeControl());
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("calls onRemove on Enter but not on other keys", () => {
    const { onRemove } = renderFilter();
    const removeBtn = removeControl();
    fireEvent.keyDown(removeBtn, { key: "Escape" });
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.keyDown(removeBtn, { key: "Enter" });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("renders with an empty metrics list without crashing", () => {
    const { onChange } = renderFilter({ metrics: [] });
    // metric change now looks up an empty list -> metricDisplay is undefined.
    fireEvent.click(screen.getByTestId("threshold-metric-dropdown"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ metricDisplay: undefined }),
    );
  });
});

// Coverage for
// app/assets/src/components/ui/controls/dropdowns/ThresholdFilterList.tsx
//
// A list of ThresholdFilter rows plus an "+ ADD THRESHOLD" affordance. The
// branching is: the Array.isArray guard around `thresholds` (so a non-array
// renders only the add row), the per-row onChange/onRemove closures that must
// carry the row's index back to the parent, and the add control's click vs
// keydown paths (Enter fires, any other key does not).
//
// The child ThresholdFilter is stubbed at the `~ui/controls/dropdowns` barrel
// so the assertions target this component's own wiring rather than the SDS
// widgets that ThresholdFilter renders.
import { fireEvent, render, screen } from "@testing-library/react";
import ThresholdFilterList from "~/components/ui/controls/dropdowns/ThresholdFilterList";

jest.mock("~ui/controls/dropdowns", () => ({
  ThresholdFilter: ({
    threshold,
    metrics,
    operators,
    onChange,
    onRemove,
  }: $TSFixMe) => (
    <div data-testid={`row-${threshold.metric}`}>
      <span data-testid={`row-summary-${threshold.metric}`}>
        {`${threshold.metric} ${threshold.operator} ${threshold.value}`}
      </span>
      <span data-testid={`row-metric-count-${threshold.metric}`}>
        {metrics.length}
      </span>
      <span data-testid={`row-operator-count-${threshold.metric}`}>
        {operators.length}
      </span>
      <button
        data-testid={`change-${threshold.metric}`}
        onClick={() => onChange({ ...threshold, value: "99" })}
      >
        change
      </button>
      <button
        data-testid={`remove-${threshold.metric}`}
        onClick={() => onRemove()}
      >
        remove
      </button>
    </div>
  ),
}));

const METRICS = [
  { text: "NT rPM", value: "nt_rpm" },
  { text: "NT Z Score", value: "nt_zscore" },
];
const OPERATORS = [">=", "<="] as $TSFixMe;

const THRESHOLDS = [
  { metric: "nt_rpm", value: "1", operator: ">=", metricDisplay: "NT rPM" },
  { metric: "nt_zscore", value: "5", operator: "<=", metricDisplay: "NT Z" },
] as $TSFixMe;

function renderList(overrides: $TSFixMe = {}) {
  const props = {
    metrics: METRICS,
    operators: OPERATORS,
    thresholds: THRESHOLDS,
    onChangeThreshold: jest.fn(),
    onRemoveThreshold: jest.fn(),
    onAddThreshold: jest.fn(),
    ...overrides,
  };
  render(<ThresholdFilterList {...props} />);
  return props;
}

describe("ThresholdFilterList", () => {
  it("renders one row per threshold and forwards metrics/operators to each", () => {
    renderList();
    expect(screen.getByTestId("row-summary-nt_rpm").textContent).toBe(
      "nt_rpm >= 1",
    );
    expect(screen.getByTestId("row-summary-nt_zscore").textContent).toBe(
      "nt_zscore <= 5",
    );
    expect(screen.getByTestId("row-metric-count-nt_rpm").textContent).toBe("2");
    expect(screen.getByTestId("row-operator-count-nt_rpm").textContent).toBe(
      "2",
    );
  });

  it("renders no rows -- but still the add control -- when thresholds is not an array", () => {
    renderList({ thresholds: null });
    expect(screen.queryByTestId("row-nt_rpm")).toBeNull();
    expect(screen.getByTestId("add-threshold")).toBeTruthy();
  });

  it("renders no rows for an empty threshold list", () => {
    renderList({ thresholds: [] });
    expect(screen.queryByTestId("row-nt_rpm")).toBeNull();
    expect(screen.getByTestId("add-threshold").textContent).toContain(
      "ADD THRESHOLD",
    );
  });

  it("reports the row index alongside the edited threshold", () => {
    const { onChangeThreshold } = renderList();
    fireEvent.click(screen.getByTestId("change-nt_zscore"));
    expect(onChangeThreshold).toHaveBeenCalledTimes(1);
    expect(onChangeThreshold).toHaveBeenCalledWith(1, {
      metric: "nt_zscore",
      value: "99",
      operator: "<=",
      metricDisplay: "NT Z",
    });
  });

  it("reports the row index when a row is removed", () => {
    const { onRemoveThreshold } = renderList();
    fireEvent.click(screen.getByTestId("remove-nt_rpm"));
    expect(onRemoveThreshold).toHaveBeenCalledWith(0);
  });

  it("adds a threshold on click", () => {
    const { onAddThreshold } = renderList();
    fireEvent.click(screen.getByTestId("add-threshold"));
    expect(onAddThreshold).toHaveBeenCalledTimes(1);
  });

  it("adds a threshold on Enter but ignores other keys", () => {
    const { onAddThreshold } = renderList();
    const addControl = screen.getByTestId("add-threshold");

    fireEvent.keyDown(addControl, { key: "a" });
    fireEvent.keyDown(addControl, { key: " " });
    expect(onAddThreshold).not.toHaveBeenCalled();

    fireEvent.keyDown(addControl, { key: "Enter" });
    expect(onAddThreshold).toHaveBeenCalledTimes(1);
  });

  it("exposes the add control as a keyboard-reachable button", () => {
    renderList();
    const addControl = screen.getByTestId("add-threshold");
    expect(addControl.getAttribute("role")).toBe("button");
    expect(addControl.getAttribute("tabindex")).toBe("0");
  });
});

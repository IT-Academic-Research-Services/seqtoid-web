// Coverage for
// app/assets/src/components/views/SampleView/components/MngsReport/components/
//   ReportFilters/components/ThresholdFilterDropdown/ThresholdFilterListSemantic/
//   ThresholdFilterSemantic/ThresholdFilterSemantic.tsx
//
// The Semantic-UI flavoured single threshold row: metric dropdown, operator
// dropdown, numeric value input and a remove button. Each of the three change
// handlers rebuilds the whole ThresholdFilterData object -- carrying the fields
// the user did not touch -- and the metric handler additionally looks the new
// metric's display text up in the `metrics` option list (which must survive a
// metric that is not in the list). The heavy Dropdown/Input widgets are stubbed
// so those handlers run for real against observable controls.
import { fireEvent, render, screen } from "@testing-library/react";

// Semantic's Grid.Row / Grid.Column are layout-only; render them as divs so the
// component's own children are reachable without pulling in the real library.
jest.mock("semantic-ui-react", () => ({
  __esModule: true,
  Grid: {
    Row: ({ children }: $TSFixMe) => <div>{children}</div>,
    Column: ({ children }: $TSFixMe) => <div>{children}</div>,
  },
}));

// The dropdown stub exposes its options and fires onChange with a value taken
// from a data attribute, so both handleMetricChange and handleOperatorChange
// execute with realistic arguments.
jest.mock("~ui/controls/dropdowns/Dropdown", () => ({
  __esModule: true,
  default: ({ placeholder, options, onChange, value }: $TSFixMe) => (
    <div>
      <span data-testid={`${placeholder}-value`}>{String(value)}</span>
      <span data-testid={`${placeholder}-options`}>
        {options.map((o: $TSFixMe) => o.text).join("|")}
      </span>
      {options.map((o: $TSFixMe) => (
        <button
          key={o.value}
          data-testid={`${placeholder}-option-${o.value}`}
          onClick={() => onChange(o.value)}
        >
          {o.text}
        </button>
      ))}
      <button
        data-testid={`${placeholder}-unknown`}
        onClick={() => onChange("not_an_option")}
      >
        unknown
      </button>
    </div>
  ),
}));

jest.mock("~/components/ui/controls/Input", () => ({
  __esModule: true,
  default: ({ onChange, value, type, className }: $TSFixMe) => (
    <input
      data-testid="value-input"
      data-classname={className}
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));

jest.mock("~/components/ui/icons/IconCloseSmall", () => ({
  __esModule: true,
  default: () => <span data-testid="close-icon" />,
}));

import ThresholdFilterSemantic from "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/ThresholdFilterDropdown/ThresholdFilterListSemantic/ThresholdFilterSemantic/ThresholdFilterSemantic";

const METRICS = [
  { text: "NT rPM", value: "nt_rpm" },
  { text: "NT Z Score", value: "nt_zscore" },
] as $TSFixMe;

const OPERATORS = [">=", "<="] as $TSFixMe;

const THRESHOLD = {
  metric: "nt_rpm",
  value: "10",
  operator: ">=",
  metricDisplay: "NT rPM",
} as $TSFixMe;

const renderRow = (overrides: $TSFixMe = {}) => {
  const props = {
    threshold: THRESHOLD,
    metrics: METRICS,
    operators: OPERATORS,
    onChange: jest.fn(),
    onRemove: jest.fn(),
    ...overrides,
  };
  render(<ThresholdFilterSemantic {...props} />);
  return props;
};

describe("ThresholdFilterSemantic -- rendering", () => {
  it("shows the threshold's current metric, operator and value", () => {
    renderRow();
    expect(screen.getByTestId("Metric-value").textContent).toBe("nt_rpm");
    expect(screen.getByTestId("Op.-value").textContent).toBe(">=");
    expect((screen.getByTestId("value-input") as HTMLInputElement).value).toBe(
      "10",
    );
  });

  it("feeds the metric list straight through and maps operators into options", () => {
    renderRow();
    expect(screen.getByTestId("Metric-options").textContent).toBe(
      "NT rPM|NT Z Score",
    );
    expect(screen.getByTestId("Op.-options").textContent).toBe(">=|<=");
  });

  it("renders a numeric, spinner-free value input and a remove affordance", () => {
    renderRow();
    const input = screen.getByTestId("value-input");
    expect(input.getAttribute("type")).toBe("number");
    expect(input.getAttribute("data-classname")).toBe("noSpinner");
    expect(screen.getByTestId("close-icon")).toBeTruthy();
  });

  it("copes with empty metric and operator lists", () => {
    renderRow({ metrics: [], operators: [] });
    expect(screen.getByTestId("Metric-options").textContent).toBe("");
    expect(screen.getByTestId("Op.-options").textContent).toBe("");
  });
});

describe("ThresholdFilterSemantic -- change handlers", () => {
  it("rebuilds the threshold with the new metric and its display text", () => {
    const { onChange } = renderRow();
    fireEvent.click(screen.getByTestId("Metric-option-nt_zscore"));

    expect(onChange).toHaveBeenCalledWith({
      metric: "nt_zscore",
      value: "10",
      operator: ">=",
      metricDisplay: "NT Z Score",
    });
  });

  it("leaves metricDisplay undefined when the metric is not in the option list", () => {
    const { onChange } = renderRow();
    fireEvent.click(screen.getByTestId("Metric-unknown"));

    expect(onChange).toHaveBeenCalledWith({
      metric: "not_an_option",
      value: "10",
      operator: ">=",
      metricDisplay: undefined,
    });
  });

  it("keeps the metric and value when only the operator changes", () => {
    const { onChange } = renderRow();
    fireEvent.click(screen.getByTestId("Op.-option-<="));

    expect(onChange).toHaveBeenCalledWith({
      metric: "nt_rpm",
      value: "10",
      operator: "<=",
      metricDisplay: "NT rPM",
    });
  });

  it("keeps the metric and operator when only the value changes", () => {
    const { onChange } = renderRow();
    fireEvent.change(screen.getByTestId("value-input"), {
      target: { value: "42" },
    });

    expect(onChange).toHaveBeenCalledWith({
      metric: "nt_rpm",
      value: "42",
      operator: ">=",
      metricDisplay: "NT rPM",
    });
  });

  it("propagates an empty value rather than dropping the edit", () => {
    const { onChange } = renderRow();
    fireEvent.change(screen.getByTestId("value-input"), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ value: "" }),
    );
  });
});

describe("ThresholdFilterSemantic -- removal", () => {
  it("fires onRemove -- and not onChange -- when the close button is clicked", () => {
    const { onChange, onRemove } = renderRow();
    fireEvent.click(screen.getByTestId("close-icon").closest("button")!);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});

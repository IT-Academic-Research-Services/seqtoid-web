// Frontend coverage for the mNGS-report ThresholdFilterDropdown (the Semantic UI
// copy that still backs the sample report filters). It keeps a working copy of
// the threshold list in local state while the dropdown is open, seeds an empty
// row on open, drops invalid rows on apply, and reverts to the props on cancel.
//
// BareDropdown is stubbed with a minimal open/close harness (the real one is a
// Semantic dropdown whose open/close is driven by portal + document events) and
// the threshold row list is stubbed so add/change/remove can be driven
// directly. The component's own state machine and static helpers run for real.
import { fireEvent, render, screen } from "@testing-library/react";
import ThresholdFilterDropdown from "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/ThresholdFilterDropdown/ThresholdFilterDropdown";

jest.mock("~ui/controls/dropdowns/BareDropdown", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="bare-dropdown">
      <span data-testid="dropdown-open">{String(props.open)}</span>
      <span data-testid="dropdown-disabled">{String(!!props.disabled)}</span>
      <div>{props.trigger}</div>
      <button data-testid="do-open" onClick={() => props.onOpen()} />
      <button data-testid="do-close-esc" onClick={() => props.onClose({})} />
      <button
        data-testid="do-close-enter"
        onClick={() => props.onClose({ key: "Enter" })}
      />
      {props.children}
    </div>
  ),
}));

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportFilters/components/ThresholdFilterDropdown/ThresholdFilterListSemantic/ThresholdFilterListSemantic",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => (
      <div data-testid="threshold-list">
        <span data-testid="threshold-count">{props.thresholds.length}</span>
        <span data-testid="threshold-json">
          {JSON.stringify(props.thresholds)}
        </span>
        <button
          data-testid="add-threshold"
          onClick={() => props.onAddThreshold()}
        />
        <button
          data-testid="fill-first"
          onClick={() =>
            props.onChangeThreshold(0, {
              metric: "nt_zscore",
              metricDisplay: "NT Z Score",
              operator: ">=",
              value: "5",
            })
          }
        />
        <button
          data-testid="remove-first"
          onClick={() => props.onRemoveThreshold(0)}
        />
      </div>
    ),
  }),
);

const options = {
  targets: [
    { text: "NT Z Score", value: "nt_zscore" },
    { text: "NT rPM", value: "nt_rpm" },
  ],
  operators: [">=", "<="],
};

const validThreshold = {
  metric: "nt_rpm",
  metricDisplay: "NT rPM",
  operator: ">=",
  value: "10",
};

describe("ThresholdFilterDropdown", () => {
  describe("isThresholdValid", () => {
    it("accepts a fully specified threshold", () => {
      expect(
        (ThresholdFilterDropdown as $TSFixMe).isThresholdValid(validThreshold),
      ).toBe(true);
    });

    it("rejects a threshold with an empty metric, operator or value", () => {
      const isValid = (ThresholdFilterDropdown as $TSFixMe).isThresholdValid;
      expect(isValid({ ...validThreshold, metric: "" })).toBe(false);
      expect(isValid({ ...validThreshold, operator: "" })).toBe(false);
      expect(isValid({ ...validThreshold, value: "" })).toBe(false);
    });

    it("rejects a NaN value", () => {
      expect(
        (ThresholdFilterDropdown as $TSFixMe).isThresholdValid({
          ...validThreshold,
          value: NaN,
        }),
      ).toBe(false);
    });
  });

  describe("areThresholdsFiltersEqual", () => {
    const areEqual = (ThresholdFilterDropdown as $TSFixMe)
      .areThresholdsFiltersEqual;

    it("treats identical lists as equal", () => {
      expect(areEqual([validThreshold], [{ ...validThreshold }])).toBe(true);
    });

    it("normalizes null to an empty list, but rejects undefined outright", () => {
      // typeof null === "object" so null is coerced to [] and compares equal,
      // whereas typeof undefined !== typeof [] and bails out immediately.
      expect(areEqual(null, [])).toBe(true);
      expect(areEqual([], null)).toBe(true);
      expect(areEqual(undefined, [])).toBe(false);
      expect(areEqual([], undefined)).toBe(false);
    });

    it("treats lists of different lengths as different", () => {
      expect(areEqual([validThreshold], [])).toBe(false);
    });

    it("treats a differing metric, operator or value as different", () => {
      expect(
        areEqual(
          [validThreshold],
          [{ ...validThreshold, metric: "nt_zscore" }],
        ),
      ).toBe(false);
      expect(
        areEqual([validThreshold], [{ ...validThreshold, operator: "<=" }]),
      ).toBe(false);
      expect(
        areEqual([validThreshold], [{ ...validThreshold, value: "11" }]),
      ).toBe(false);
    });

    it("treats mismatched types as different", () => {
      expect(areEqual("a", ["a"])).toBe(false);
    });
  });

  it("shows the count label and syncs valid props thresholds into state", () => {
    render(
      <ThresholdFilterDropdown
        options={options}
        thresholds={[validThreshold, { metric: "", operator: "", value: "" }]}
        onApply={jest.fn()}
      />,
    );

    // Only the valid threshold survives getDerivedStateFromProps.
    expect(screen.getByTestId("threshold-count").textContent).toBe("1");
    // useDropdownLabelCounter defaults to true -> DropdownLabel with the count.
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("Threshold filters:")).toBeTruthy();
  });

  it("renders the bare label without a colon when there are no thresholds", () => {
    render(
      <ThresholdFilterDropdown
        options={options}
        thresholds={[]}
        onApply={jest.fn()}
      />,
    );

    expect(screen.getByText("Threshold filters")).toBeTruthy();
    expect(screen.queryByText("Threshold filters:")).toBeNull();
    expect(screen.getByTestId("threshold-count").textContent).toBe("0");
  });

  it("renders '<n> selected' instead of a counter chip when useDropdownLabelCounter is false", () => {
    render(
      <ThresholdFilterDropdown
        options={options}
        thresholds={[validThreshold, { ...validThreshold, value: "20" }]}
        useDropdownLabelCounter={false}
        onApply={jest.fn()}
      />,
    );

    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("forwards the disabled flag to the dropdown", () => {
    render(
      <ThresholdFilterDropdown
        options={options}
        thresholds={[]}
        disabled
        onApply={jest.fn()}
      />,
    );

    expect(screen.getByTestId("dropdown-disabled").textContent).toBe("true");
  });

  it("seeds an empty threshold row the first time it opens", () => {
    render(
      <ThresholdFilterDropdown
        options={options}
        thresholds={[]}
        onApply={jest.fn()}
      />,
    );

    expect(screen.getByTestId("dropdown-open").textContent).toBe("false");
    fireEvent.click(screen.getByTestId("do-open"));

    expect(screen.getByTestId("dropdown-open").textContent).toBe("true");
    expect(screen.getByTestId("threshold-count").textContent).toBe("1");
    // The seeded row uses the first metric / operator from the options.
    expect(
      JSON.parse(screen.getByTestId("threshold-json").textContent ?? ""),
    ).toEqual([
      {
        metric: "nt_zscore",
        metricDisplay: "NT Z Score",
        operator: ">=",
        value: "",
      },
    ]);
  });

  it("does not seed another row when thresholds already exist", () => {
    render(
      <ThresholdFilterDropdown
        options={options}
        thresholds={[validThreshold]}
        onApply={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("do-open"));
    expect(screen.getByTestId("threshold-count").textContent).toBe("1");
  });

  it("adds and removes threshold rows", () => {
    render(
      <ThresholdFilterDropdown
        options={options}
        thresholds={[validThreshold]}
        onApply={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("add-threshold"));
    expect(screen.getByTestId("threshold-count").textContent).toBe("2");

    fireEvent.click(screen.getByTestId("remove-first"));
    expect(screen.getByTestId("threshold-count").textContent).toBe("1");
    expect(screen.getByTestId("threshold-json").textContent).toContain(
      "nt_zscore",
    );
  });

  it("applies only valid thresholds and closes the dropdown", () => {
    const onApply = jest.fn();
    render(
      <ThresholdFilterDropdown
        options={options}
        thresholds={[validThreshold]}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByTestId("do-open"));
    // Add a blank row that should be dropped on apply.
    fireEvent.click(screen.getByTestId("add-threshold"));
    expect(screen.getByTestId("threshold-count").textContent).toBe("2");

    fireEvent.click(screen.getByTestId("apply"));

    expect(onApply).toHaveBeenCalledWith([validThreshold]);
    expect(screen.getByTestId("dropdown-open").textContent).toBe("false");
    expect(screen.getByTestId("threshold-count").textContent).toBe("1");
  });

  it("applies edits made to an existing row", () => {
    const onApply = jest.fn();
    render(
      <ThresholdFilterDropdown
        options={options}
        thresholds={[validThreshold]}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByTestId("fill-first"));
    fireEvent.click(screen.getByTestId("apply"));

    expect(onApply).toHaveBeenCalledWith([
      {
        metric: "nt_zscore",
        metricDisplay: "NT Z Score",
        operator: ">=",
        value: "5",
      },
    ]);
  });

  it("discards pending edits on cancel", () => {
    const onApply = jest.fn();
    render(
      <ThresholdFilterDropdown
        options={options}
        thresholds={[validThreshold]}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByTestId("do-open"));
    fireEvent.click(screen.getByTestId("add-threshold"));
    expect(screen.getByTestId("threshold-count").textContent).toBe("2");

    fireEvent.click(screen.getByTestId("cancel"));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId("dropdown-open").textContent).toBe("false");
    expect(screen.getByTestId("threshold-count").textContent).toBe("1");
  });

  it("applies on close when Enter was pressed, and cancels otherwise", () => {
    const onApply = jest.fn();
    render(
      <ThresholdFilterDropdown
        options={options}
        thresholds={[validThreshold]}
        onApply={onApply}
      />,
    );

    fireEvent.click(screen.getByTestId("do-open"));
    fireEvent.click(screen.getByTestId("do-close-enter"));
    expect(onApply).toHaveBeenCalledTimes(1);

    onApply.mockClear();
    fireEvent.click(screen.getByTestId("do-open"));
    fireEvent.click(screen.getByTestId("do-close-esc"));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId("dropdown-open").textContent).toBe("false");
  });

  it("tolerates a missing options prop", () => {
    render(<ThresholdFilterDropdown thresholds={[]} onApply={jest.fn()} />);
    expect(screen.getByTestId("threshold-count").textContent).toBe("0");
  });
});

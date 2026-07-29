// Coverage for
// .../BulkDownloadModal/components/BulkDownloadModalOptions/components/ThresholdFilterModal/ThresholdFilterModal.tsx
//
// ThresholdFilterModal owns the threshold list state for the biom_format
// download option. Its three callbacks (add / change / remove) each rewrite the
// list and -- for change and remove -- push a *filtered* copy up to
// addFilterList, dropping any row that is missing a metric or a value. The
// presentational ThresholdFilterList is replaced with a stub so the tests can
// drive those callbacks directly and assert on both the state it keeps and the
// payload it forwards.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThresholdFilterModal } from "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalOptions/components/ThresholdFilterModal/ThresholdFilterModal";

/* eslint-disable @typescript-eslint/no-explicit-any */

const mockListProps: any[] = [];

jest.mock("~/components/ui/controls/dropdowns/ThresholdFilterList", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: any) => {
      mockListProps.push(props);
      const el = ReactLib.createElement;
      return el(
        "div",
        { "data-testid": "threshold-list" },
        el(
          "span",
          { "data-testid": "threshold-count" },
          String(props.thresholds.length),
        ),
        el(
          "span",
          { "data-testid": "metric-count" },
          String(props.metrics.length),
        ),
        el("span", { "data-testid": "operators" }, props.operators.join(",")),
        props.thresholds.map((t: any, idx: number) =>
          el(
            "span",
            { key: idx, "data-testid": `row-${idx}` },
            `${t.metric}|${t.operator}|${t.value}`,
          ),
        ),
        el(
          "button",
          { "data-testid": "add", onClick: () => props.onAddThreshold() },
          "add",
        ),
      );
    },
  };
});

const latestProps = () => mockListProps[mockListProps.length - 1];

// The stub hands the callbacks back raw, so state updates triggered by calling
// them have to be flushed manually.
const changeThreshold = (idx: number, threshold: any) =>
  act(() => {
    latestProps().onChangeThreshold(idx, threshold);
  });

const removeThreshold = (idx: number) =>
  act(() => {
    latestProps().onRemoveThreshold(idx);
  });

describe("ThresholdFilterModal", () => {
  beforeEach(() => {
    mockListProps.length = 0;
  });

  it("starts with a single blank threshold and passes the metric/operator options down", () => {
    const addFilterList = jest.fn();
    render(<ThresholdFilterModal addFilterList={addFilterList} />);

    expect(screen.getByTestId("threshold-count").textContent).toBe("1");
    expect(screen.getByTestId("row-0").textContent).toBe("|>=|");
    expect(screen.getByTestId("operators").textContent).toBe(">=,<=");
    expect(
      Number(screen.getByTestId("metric-count").textContent),
    ).toBeGreaterThan(0);
    // Rendering alone must not push anything upstream.
    expect(addFilterList).not.toHaveBeenCalled();
  });

  it("appends another blank row on add without notifying the parent", () => {
    const addFilterList = jest.fn();
    render(<ThresholdFilterModal addFilterList={addFilterList} />);

    fireEvent.click(screen.getByTestId("add"));

    expect(screen.getByTestId("threshold-count").textContent).toBe("2");
    expect(screen.getByTestId("row-1").textContent).toBe("|>=|");
    expect(addFilterList).not.toHaveBeenCalled();
  });

  it("forwards a completed threshold and the stringified summary on change", () => {
    const addFilterList = jest.fn();
    render(<ThresholdFilterModal addFilterList={addFilterList} />);

    fireEvent.click(screen.getByTestId("add"));
    changeThreshold(0, {
      metric: "nt_zscore",
      metricDisplay: "NT Z Score",
      operator: ">=",
      value: "5",
    });

    expect(addFilterList).toHaveBeenCalledTimes(1);
    const [downloadType, fieldType, value, displayName] =
      addFilterList.mock.calls[0];
    expect(downloadType).toBe("biom_format");
    expect(fieldType).toBe("filter_by");
    // The still-blank second row is filtered out of the forwarded value...
    expect(value).toHaveLength(1);
    expect(value[0].metric).toBe("nt_zscore");
    // ...but it is still part of the display string.
    expect(displayName).toBe("nt_zscore>=5 >= ");
    // Local state keeps both rows.
    expect(screen.getByTestId("threshold-count").textContent).toBe("2");
    expect(screen.getByTestId("row-0").textContent).toBe("nt_zscore|>=|5");
  });

  it("drops rows that have a metric but no value, and rows with a value but no metric", () => {
    const addFilterList = jest.fn();
    render(<ThresholdFilterModal addFilterList={addFilterList} />);

    // Row with a metric and no value.
    changeThreshold(0, {
      metric: "nt_rpm",
      metricDisplay: "NT rPM",
      operator: "<=",
      value: "",
    });
    expect(addFilterList.mock.calls[0][2]).toEqual([]);

    // Add a second row that has a value but no metric.
    fireEvent.click(screen.getByTestId("add"));
    changeThreshold(1, {
      metric: "",
      metricDisplay: "",
      operator: ">=",
      value: "9",
    });
    expect(addFilterList).toHaveBeenCalledTimes(2);
    expect(addFilterList.mock.calls[1][2]).toEqual([]);
    expect(addFilterList.mock.calls[1][3]).toBe("nt_rpm<= >=9 ");
  });

  it("removes a row and re-publishes the remaining valid thresholds", () => {
    const addFilterList = jest.fn();
    render(<ThresholdFilterModal addFilterList={addFilterList} />);

    fireEvent.click(screen.getByTestId("add"));
    changeThreshold(0, {
      metric: "nt_zscore",
      metricDisplay: "NT Z Score",
      operator: ">=",
      value: "1",
    });
    changeThreshold(1, {
      metric: "nr_zscore",
      metricDisplay: "NR Z Score",
      operator: "<=",
      value: "2",
    });
    expect(addFilterList.mock.calls[1][2]).toHaveLength(2);

    removeThreshold(0);

    expect(addFilterList).toHaveBeenCalledTimes(3);
    const forwarded = addFilterList.mock.calls[2][2];
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].metric).toBe("nr_zscore");
    expect(addFilterList.mock.calls[2][3]).toBe("nr_zscore<=2 ");
    expect(screen.getByTestId("threshold-count").textContent).toBe("1");
    expect(screen.getByTestId("row-0").textContent).toBe("nr_zscore|<=|2");
  });

  it("publishes an empty list once the last row is removed", () => {
    const addFilterList = jest.fn();
    render(<ThresholdFilterModal addFilterList={addFilterList} />);

    removeThreshold(0);

    expect(addFilterList).toHaveBeenCalledTimes(1);
    expect(addFilterList.mock.calls[0][2]).toEqual([]);
    expect(addFilterList.mock.calls[0][3]).toBe("");
    expect(screen.getByTestId("threshold-count").textContent).toBe("0");
  });
});

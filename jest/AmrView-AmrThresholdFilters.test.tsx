// Coverage: app/assets/src/components/views/SampleView/components/AmrView/
//   components/AmrFiltersContainer/components/AmrThresholdFilters/AmrThresholdFilters.tsx
//
// AmrThresholdFilters is a thin wrapper around ThresholdFilterSDS. It reads the
// active filters out of AmrContext, flattens the THRESHOLD ones into a single
// selectedThresholds list (skipping non-threshold filters and threshold filters
// with no thresholdFilters array), and on apply re-buckets the flat list back
// into a per-column filter map that it dispatches. The heavy SDS filter widget
// is stubbed so the assertions land on this component's own reduce/dispatch
// logic, and both the hideFilters=true (null) and hideFilters=false render
// branches are exercised.
import { fireEvent, render, screen } from "@testing-library/react";

let lastFilterProps: $TSFixMe = null;
jest.mock("~/components/common/filters/ThresholdFilterSDS", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    lastFilterProps = props;
    const ReactLib = require("react");
    return ReactLib.createElement(
      "button",
      {
        "data-testid": "threshold-filter-sds",
        "data-disabled": String(!!props.disabled),
        "data-selected-count": String(props.selectedThresholds.length),
        onClick: () =>
          props.onApply([
            { metric: "contigs", operator: ">=", value: "2" },
            { metric: "reads", operator: "<=", value: "9" },
          ]),
      },
      "filter",
    );
  },
}));

import { AmrContext } from "~/components/views/SampleView/components/AmrView/amrContext/reducer";
import { AmrThresholdFilters } from "~/components/views/SampleView/components/AmrView/components/AmrFiltersContainer/components/AmrThresholdFilters/AmrThresholdFilters";

const renderWithContext = (activeFilters: $TSFixMe, hideFilters = false) => {
  const amrContextDispatch = jest.fn();
  const utils = render(
    <AmrContext.Provider
      value={
        {
          amrContextState: {
            reportTableDownloadWithAppliedFiltersLink: null,
            activeFilters,
            drugClasses: null,
          },
          amrContextDispatch,
        } as $TSFixMe
      }
    >
      <AmrThresholdFilters hideFilters={hideFilters} />
    </AmrContext.Provider>,
  );
  return { amrContextDispatch, ...utils };
};

beforeEach(() => {
  lastFilterProps = null;
});

describe("AmrThresholdFilters", () => {
  it("renders nothing when hideFilters is true", () => {
    renderWithContext(null, true);
    expect(screen.queryByTestId("threshold-filter-sds")).toBeNull();
  });

  it("renders the SDS filter and passes the metric options", () => {
    renderWithContext(null, false);
    expect(screen.getByTestId("threshold-filter-sds")).toBeTruthy();
    // one metric option per filterable threshold column
    expect(lastFilterProps.metricOptions).toHaveLength(8);
    expect(lastFilterProps.metricOptions[0]).toEqual({
      text: "Number of Contigs",
      value: "contigs",
    });
    expect(lastFilterProps.disabled).toBe(false);
  });

  it("flattens THRESHOLD filters into selectedThresholds and skips others", () => {
    renderWithContext({
      contigs: {
        key: "contigs",
        type: "threshold",
        params: {
          thresholdFilters: [
            { metric: "contigs", operator: ">=", value: "2" },
            { metric: "contigs", operator: "<=", value: "9" },
          ],
        },
      },
      // threshold filter with no thresholdFilters array -> skipped
      reads: {
        key: "reads",
        type: "threshold",
        params: {},
      },
      // non-threshold filter -> skipped
      drugClass: {
        key: "drugClass",
        type: "multiple",
        params: { multiSelected: ["tetracycline"] },
      },
    });
    expect(
      screen.getByTestId("threshold-filter-sds").dataset.selectedCount,
    ).toBe("2");
    expect(lastFilterProps.selectedThresholds).toEqual([
      { metric: "contigs", operator: ">=", value: "2" },
      { metric: "contigs", operator: "<=", value: "9" },
    ]);
  });

  it("handles a null/undefined activeFilters map without throwing", () => {
    renderWithContext(undefined, false);
    expect(lastFilterProps.selectedThresholds).toEqual([]);
  });

  it("re-buckets applied filters per column and dispatches the update", () => {
    const { amrContextDispatch } = renderWithContext(null, false);
    fireEvent.click(screen.getByTestId("threshold-filter-sds"));

    expect(amrContextDispatch).toHaveBeenCalledTimes(1);
    const action = amrContextDispatch.mock.calls[0][0];
    expect(action.type).toBe("UPDATE_ACTIVE_THRESHOLD_FILTERS");

    const payload = action.payload;
    // every filterable column gets an entry, seeded empty
    expect(Object.keys(payload)).toHaveLength(8);
    // the two applied filters land in their respective column buckets
    expect(payload["contigs"].params.thresholdFilters).toEqual([
      { metric: "contigs", operator: ">=", value: "2" },
    ]);
    expect(payload["reads"].params.thresholdFilters).toEqual([
      { metric: "reads", operator: "<=", value: "9" },
    ]);
    // an untouched column stays empty
    expect(payload["rpm"].params.thresholdFilters).toEqual([]);
    expect(payload["contigs"].type).toBe("threshold");
  });
});

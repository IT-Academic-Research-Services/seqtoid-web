// Coverage: app/assets/src/components/views/SampleView/components/AmrView/components/AmrFiltersContainer/AmrFiltersContainer.tsx
//
// The container owns two things worth testing: the initial filter shapes it
// exports (THRESHOLD_FILTER_INIT / DATA_FILTER_INIT) and the data-filter
// function it hands upward through setDataFilterFunc. That function closes over
// the private applyFilter switch, so every filter type (threshold / multiple /
// single / unknown) and every short-circuit inside it is driven through the
// captured callback. The two filter panels and the filter button are stubbed --
// they have their own suites and pull in heavy dropdown machinery.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("~/components/ui/controls/buttons/FilterButtonWithCounter", () => ({
  FilterButtonWithCounter: ({
    filterCounter,
    onFilterToggle,
    showFilters,
  }: $TSFixMe) => (
    <button
      data-testid="filter-button"
      data-show-filters={String(showFilters)}
      onClick={onFilterToggle}
    >
      {filterCounter}
    </button>
  ),
}));

jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrFiltersContainer/components/AmrThresholdFilters",
  () => ({
    AmrThresholdFilters: ({ hideFilters }: $TSFixMe) => (
      <div data-testid="threshold-filters" data-hidden={String(hideFilters)} />
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrFiltersContainer/components/DrugClassFilter",
  () => ({
    DrugClassFilter: ({ hideFilters }: $TSFixMe) => (
      <div data-testid="drug-class-filter" data-hidden={String(hideFilters)} />
    ),
  }),
);

import { AmrContext } from "~/components/views/SampleView/components/AmrView/amrContext/reducer";
import {
  AmrFiltersContainer,
  DATA_FILTER_INIT,
  THRESHOLD_FILTER_INIT,
} from "~/components/views/SampleView/components/AmrView/components/AmrFiltersContainer/AmrFiltersContainer";

const ROWS = [
  { gene: "aadA", contigs: "5", drugClass: "aminoglycoside; macrolide" },
  { gene: "tetM", contigs: "1", drugClass: "tetracycline" },
  { gene: "blaZ", contigs: "not-a-number", drugClass: "beta-lactam" },
] as $TSFixMe[];

/**
 * Renders the container with the supplied activeFilters and returns the data
 * filter function the component pushed up through setDataFilterFunc.
 */
const renderAndGetFilterFunc = (
  activeFilters: $TSFixMe,
  extraProps: $TSFixMe = {},
) => {
  const setDataFilterFunc = jest.fn();
  const setHideFilters = jest.fn();
  const utils = render(
    <AmrContext.Provider
      value={
        {
          amrContextState: {
            reportTableDownloadWithAppliedFiltersLink: null,
            activeFilters,
            drugClasses: null,
          },
          amrContextDispatch: jest.fn(),
        } as $TSFixMe
      }
    >
      <AmrFiltersContainer
        setDataFilterFunc={setDataFilterFunc}
        hideFilters={false}
        setHideFilters={setHideFilters}
        {...extraProps}
      />
    </AmrContext.Provider>,
  );

  expect(setDataFilterFunc).toHaveBeenCalled();
  const wrapped = setDataFilterFunc.mock.calls[0][0];
  return {
    filterFunc: wrapped() as (data: $TSFixMe[]) => $TSFixMe[],
    setHideFilters,
    setDataFilterFunc,
    ...utils,
  };
};

describe("THRESHOLD_FILTER_INIT / DATA_FILTER_INIT", () => {
  it("creates one empty threshold filter per filterable column", () => {
    const keys = Object.keys(THRESHOLD_FILTER_INIT);
    expect(keys).toEqual([
      "contigs",
      "contigCoverageBreadth",
      "contigPercentId",
      "reads",
      "rpm",
      "readCoverageBreadth",
      "readCoverageDepth",
      "dpm",
    ]);
    keys.forEach(key => {
      const filter = THRESHOLD_FILTER_INIT[key];
      expect(filter.key).toBe(key);
      expect(filter.type).toBe("threshold");
      expect(filter.params.thresholdFilters).toEqual([]);
    });
  });

  it("wires a numeric transform onto each threshold column", () => {
    // rpm/dpm read a dedicated numeric field; the rest parse the string cell.
    expect(THRESHOLD_FILTER_INIT["rpm"].transform({ rpm: 12.5 })).toBe(12.5);
    expect(THRESHOLD_FILTER_INIT["dpm"].transform({ dpm: 0.25 })).toBe(0.25);
    expect(THRESHOLD_FILTER_INIT["contigs"].transform({ contigs: "7" })).toBe(
      7,
    );
    expect(THRESHOLD_FILTER_INIT["contigs"].transform({ contigs: null })).toBe(
      null,
    );
  });

  it("adds a drug class multi-select filter on top of the threshold filters", () => {
    const drugClass = DATA_FILTER_INIT["drugClass"] as $TSFixMe;
    expect(drugClass.key).toBe("drugClass");
    expect(drugClass.type).toBe("multiple");
    expect(drugClass.params.multiSelected).toEqual([]);
    // The transform splits on ";" and trims each drug class.
    expect(
      drugClass.transform({ drugClass: "macrolide; tetracycline" }),
    ).toEqual(["macrolide", "tetracycline"]);
    expect(Object.keys(DATA_FILTER_INIT)).toHaveLength(
      Object.keys(THRESHOLD_FILTER_INIT).length + 1,
    );
  });
});

describe("AmrFiltersContainer", () => {
  it("renders both filter panels and forwards hideFilters", () => {
    renderAndGetFilterFunc(DATA_FILTER_INIT);
    expect(screen.getByTestId("threshold-filters").dataset.hidden).toBe(
      "false",
    );
    expect(screen.getByTestId("drug-class-filter").dataset.hidden).toBe(
      "false",
    );
    expect(screen.getByTestId("filter-button").dataset.showFilters).toBe(
      "true",
    );
  });

  it("shows the active filter count from the context filters", () => {
    renderAndGetFilterFunc({
      contigs: {
        key: "contigs",
        params: {
          thresholdFilters: [
            { metric: "contigs", operator: ">=", value: "2" },
            { metric: "contigs", operator: "<=", value: "9" },
          ],
        },
        type: "threshold",
      },
      drugClass: {
        key: "drugClass",
        params: { multiSelected: ["tetracycline"] },
        type: "multiple",
      },
    });
    expect(screen.getByTestId("filter-button").textContent).toBe("3");
  });

  it("shows a zero count when there are no active filters in context", () => {
    renderAndGetFilterFunc(null);
    expect(screen.getByTestId("filter-button").textContent).toBe("0");
  });

  it("toggles hideFilters when the filter button is clicked", () => {
    const { setHideFilters } = renderAndGetFilterFunc(DATA_FILTER_INIT);
    fireEvent.click(screen.getByTestId("filter-button"));
    expect(setHideFilters).toHaveBeenCalledWith(true);
  });

  it("passes hideFilters=true down to the panels", () => {
    renderAndGetFilterFunc(DATA_FILTER_INIT, { hideFilters: true });
    expect(screen.getByTestId("threshold-filters").dataset.hidden).toBe("true");
    expect(screen.getByTestId("filter-button").dataset.showFilters).toBe(
      "false",
    );
  });
});

describe("AmrFiltersContainer data filter function", () => {
  it("returns a copy of the data when there are no filters", () => {
    const { filterFunc } = renderAndGetFilterFunc(null);
    const result = filterFunc(ROWS);
    expect(result).toEqual(ROWS);
    expect(result).not.toBe(ROWS);
  });

  it("returns every row when the initial (empty) filters are applied", () => {
    const { filterFunc } = renderAndGetFilterFunc(DATA_FILTER_INIT);
    expect(filterFunc(ROWS)).toHaveLength(3);
  });

  it("drops rows below a >= threshold and rows whose value is not numeric", () => {
    const { filterFunc } = renderAndGetFilterFunc({
      contigs: {
        ...DATA_FILTER_INIT["contigs"],
        params: {
          thresholdFilters: [{ metric: "contigs", operator: ">=", value: "2" }],
        },
      },
    });
    // contigs 5 passes; contigs 1 fails; "not-a-number" -> NaN also fails.
    expect(filterFunc(ROWS).map((r: $TSFixMe) => r.gene)).toEqual(["aadA"]);
  });

  it("drops rows above a <= threshold", () => {
    const { filterFunc } = renderAndGetFilterFunc({
      contigs: {
        ...DATA_FILTER_INIT["contigs"],
        params: {
          thresholdFilters: [{ metric: "contigs", operator: "<=", value: "2" }],
        },
      },
    });
    expect(filterFunc(ROWS).map((r: $TSFixMe) => r.gene)).toEqual(["tetM"]);
  });

  it("applies a lower and an upper bound together", () => {
    const { filterFunc } = renderAndGetFilterFunc({
      contigs: {
        ...DATA_FILTER_INIT["contigs"],
        params: {
          thresholdFilters: [
            { metric: "contigs", operator: ">=", value: "1" },
            { metric: "contigs", operator: "<=", value: "4" },
          ],
        },
      },
    });
    expect(filterFunc(ROWS).map((r: $TSFixMe) => r.gene)).toEqual(["tetM"]);
  });

  it("ignores an unrecognised threshold operator", () => {
    const { filterFunc } = renderAndGetFilterFunc({
      contigs: {
        ...DATA_FILTER_INIT["contigs"],
        params: {
          thresholdFilters: [{ metric: "contigs", operator: "==", value: "5" }],
        },
      },
    });
    // No operator branch matches, so only the NaN row is removed.
    expect(filterFunc(ROWS).map((r: $TSFixMe) => r.gene)).toEqual([
      "aadA",
      "tetM",
    ]);
  });

  it("leaves the data alone when a threshold filter targets a non-threshold column", () => {
    const { filterFunc } = renderAndGetFilterFunc({
      gene: {
        key: "gene",
        params: {
          thresholdFilters: [{ metric: "gene", operator: ">=", value: "2" }],
        },
        transform: (d: $TSFixMe) => d.gene,
        type: "threshold",
      },
    });
    expect(filterFunc(ROWS)).toHaveLength(3);
  });

  it("filters on a multi-select filter and keeps rows matching any selection", () => {
    const { filterFunc } = renderAndGetFilterFunc({
      drugClass: {
        ...DATA_FILTER_INIT["drugClass"],
        params: { multiSelected: ["tetracycline", "macrolide"] },
      },
    });
    expect(filterFunc(ROWS).map((r: $TSFixMe) => r.gene)).toEqual([
      "aadA",
      "tetM",
    ]);
  });

  it("returns every row when nothing is multi-selected", () => {
    const { filterFunc } = renderAndGetFilterFunc({
      drugClass: {
        ...DATA_FILTER_INIT["drugClass"],
        params: { multiSelected: [] },
      },
    });
    expect(filterFunc(ROWS)).toHaveLength(3);
  });

  it("supports a single-select filter, and no-ops when nothing is selected", () => {
    const singleFilter = (selected?: string) => ({
      cutoff: {
        key: "cutoff",
        params: selected ? { selected } : {},
        transform: (d: $TSFixMe) => d.gene,
        type: "single",
      },
    });

    const selected = renderAndGetFilterFunc(singleFilter("tetM"));
    expect(selected.filterFunc(ROWS).map((r: $TSFixMe) => r.gene)).toEqual([
      "tetM",
    ]);

    const unselected = renderAndGetFilterFunc(singleFilter());
    expect(unselected.filterFunc(ROWS)).toHaveLength(3);
  });

  it("passes rows through untouched for an unknown filter type or an incomplete filter", () => {
    const unknownType = renderAndGetFilterFunc({
      cutoff: {
        key: "cutoff",
        params: { selected: "tetM" },
        type: "nonsense",
      },
    });
    expect(unknownType.filterFunc(ROWS)).toHaveLength(3);

    const incomplete = renderAndGetFilterFunc({
      cutoff: { key: "cutoff", params: undefined, type: undefined },
    });
    expect(incomplete.filterFunc(ROWS)).toHaveLength(3);
  });

  it("uses the raw row when a filter declares no transform", () => {
    const { filterFunc } = renderAndGetFilterFunc({
      cutoff: {
        key: "cutoff",
        params: { selected: ROWS[1] },
        type: "single",
      },
    });
    expect(filterFunc(ROWS)).toEqual([ROWS[1]]);
  });
});

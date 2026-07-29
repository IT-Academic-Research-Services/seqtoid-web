// Branch coverage for
// app/assets/src/components/views/SampleView/components/MngsReport/components/ReportStatsRow/ReportStatsRow.tsx
//
// Only the row's utils module had a spec; the component itself was never
// rendered, so its single conditional
//
//   {!!countFilters(currentTab, selectedOptions) && (<Clear Filters button/>)}
//
// had neither arm exercised. Both arms are covered here, along with the two
// shapes of the row-count message the component delegates to filteredMessage.
import { fireEvent, render, screen } from "@testing-library/react";
import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { ReportStatsRow } from "~/components/views/SampleView/components/MngsReport/components/ReportStatsRow/ReportStatsRow";

const genus = (species: $TSFixMe[], filteredSpecies: $TSFixMe[]) => ({
  taxId: 570,
  species,
  filteredSpecies,
});

const noFilters = {
  categories: {},
  thresholdsShortReads: [],
  thresholdsLongReads: [],
  taxa: [],
  annotations: [],
} as $TSFixMe;

const renderRow = (overrides: $TSFixMe = {}) => {
  const clearAllFilters = jest.fn();
  const utils = render(
    <ReportStatsRow
      currentTab={WORKFLOW_TABS.SHORT_READ_MNGS as $TSFixMe}
      filteredReportData={[genus([{}, {}], [{}, {}])] as $TSFixMe}
      reportData={[genus([{}, {}], [{}, {}])] as $TSFixMe}
      pipelineRun={{ pipeline_version: "8.0" } as $TSFixMe}
      reportMetadata={{} as $TSFixMe}
      selectedOptions={noFilters}
      clearAllFilters={clearAllFilters}
      {...overrides}
    />,
  );
  return { ...utils, clearAllFilters };
};

const clearButton = () => screen.queryByText("Clear Filters");

describe("ReportStatsRow clear-filters control", () => {
  it("hides the clear-filters button when no filters are selected", () => {
    renderRow();

    expect(clearButton()).toBeNull();
    // The row still reports the unfiltered total.
    expect(screen.getByTestId("stats-info").textContent).toContain("3 rows");
  });

  it("shows the clear-filters button once a taxon filter is selected", () => {
    const { clearAllFilters } = renderRow({
      selectedOptions: { ...noFilters, taxa: [{ id: 1, name: "Klebsiella" }] },
    });

    const button = clearButton();
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLElement);
    expect(clearAllFilters).toHaveBeenCalledTimes(1);
  });

  it("counts threshold filters from the short-read list on the short-read tab", () => {
    // thresholdsLongReads is deliberately non-empty and must be ignored here.
    renderRow({
      selectedOptions: {
        ...noFilters,
        thresholdsShortReads: [{ metric: "nt_zscore" }],
        thresholdsLongReads: [],
      },
    });

    expect(clearButton()).not.toBeNull();
  });

  it("ignores the short-read threshold list on the long-read tab", () => {
    renderRow({
      currentTab: WORKFLOW_TABS.LONG_READ_MNGS as $TSFixMe,
      selectedOptions: {
        ...noFilters,
        thresholdsShortReads: [{ metric: "nt_zscore" }],
        thresholdsLongReads: [],
      },
    });

    expect(clearButton()).toBeNull();
  });
});

describe("ReportStatsRow row-count message", () => {
  it("reports only the total when nothing is filtered out", () => {
    renderRow();
    expect(screen.getByTestId("stats-info").textContent).toContain("3 rows");
    expect(screen.getByTestId("stats-info").textContent).not.toContain(
      "passing the above filters",
    );
  });

  it("reports the passing/total split when rows are filtered out", () => {
    renderRow({
      filteredReportData: [genus([{}, {}], [{}])] as $TSFixMe,
      reportData: [genus([{}, {}], [{}])] as $TSFixMe,
    });
    // filtered = 1 genus + 1 filteredSpecies = 2; total = 1 genus + 2 species = 3
    expect(screen.getByTestId("stats-info").textContent).toContain(
      "2 rows passing the above filters, out of 3 total rows",
    );
  });
});

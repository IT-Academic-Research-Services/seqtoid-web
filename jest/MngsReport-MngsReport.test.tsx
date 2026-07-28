// Coverage: app/assets/src/components/views/SampleView/components/MngsReport/MngsReport.tsx
//
// MngsReport is the top-level mNGS report switch: when the report is ready, has
// data, is not loading and has a sample, it renders the filter bar + stats +
// either the table view or the tree view (chosen by `view`); otherwise it falls
// back to SampleViewMessage. Every child is stubbed to a marker so the tests can
// assert which branch rendered and which props (e.g. the zero-taxon flag) were
// threaded through. Analytics and the consensus-genome util are stubbed too.
import { render, screen } from "@testing-library/react";

jest.mock("./mngs_report.scss", () => ({}), { virtual: true });

jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: {
    PIPELINE_SAMPLE_REPORT_TAXON_SIDEBAR_LINK_CLICKED: "taxon_link_clicked",
  },
  useWithAnalytics: () => (fn: $TSFixMe) => fn,
}));

jest.mock("~/components/views/SampleView/utils", () => ({
  getConsensusGenomeData: () => ({}),
}));

jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportFilters",
  () => ({ ReportFilters: () => <div data-testid="report-filters" /> }),
);
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportStatsRow",
  () => ({ ReportStatsRow: () => <div data-testid="report-stats" /> }),
);
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportTable",
  () => ({ ReportTable: () => <div data-testid="report-table" /> }),
);
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/ReportViewSelector",
  () => ({
    ReportViewSelector: () => <div data-testid="report-view-selector" />,
  }),
);
jest.mock(
  "~/components/views/SampleView/components/MngsReport/components/TaxonTreeVis",
  () => ({ TaxonTreeVis: () => <div data-testid="taxon-tree" /> }),
);

let mockMessageProps: $TSFixMe = null;
jest.mock("~/components/views/SampleView/components/SampleViewMessage", () => ({
  SampleViewMessage: (props: $TSFixMe) => {
    mockMessageProps = props;
    return <div data-testid="sample-view-message" />;
  },
}));

import { WORKFLOW_TABS } from "~/components/utils/workflows";
import { MngsReport } from "~/components/views/SampleView/components/MngsReport/MngsReport";

const makeProps = (overrides: $TSFixMe = {}) => ({
  backgrounds: [],
  currentTab: WORKFLOW_TABS.SHORT_READ_MNGS,
  clearAllFilters: jest.fn(),
  dispatchSelectedOptions: jest.fn(),
  enableMassNormalizedBackgrounds: false,
  filteredReportData: [{ taxId: 1 }],
  handleAnnotationUpdate: jest.fn(),
  handleBlastClick: jest.fn(),
  handleConsensusGenomeClick: jest.fn(),
  handleCoverageVizClick: jest.fn(),
  handlePreviousConsensusGenomeClick: jest.fn(),
  handleTaxonClick: jest.fn(),
  handleViewClick: jest.fn(),
  lineageData: {},
  loadingReport: false,
  ownedBackgrounds: [],
  otherBackgrounds: [],
  pipelineRun: { id: 1, pipeline_version: "8.0" },
  project: { id: 2, name: "proj" },
  reportData: [{ taxId: 1 }],
  reportMetadata: { reportReady: true, hasByteRanges: true },
  sample: { id: 3, editable: true },
  selectedOptions: {
    background: 5,
    metricShortReads: "nt_rpm",
    metricLongReads: "nt_bpm",
    nameType: "Scientific",
  },
  snapshotShareId: undefined,
  view: "table",
  ...overrides,
});

const renderReport = (overrides: $TSFixMe = {}) =>
  render(<MngsReport {...(makeProps(overrides) as $TSFixMe)} />);

beforeEach(() => {
  mockMessageProps = null;
});

describe("MngsReport", () => {
  it("renders the report container with the table view when everything is ready", () => {
    renderReport({ view: "table" });
    expect(screen.getByTestId("report-filters")).toBeTruthy();
    expect(screen.getByTestId("report-stats")).toBeTruthy();
    expect(screen.getByTestId("report-table")).toBeTruthy();
    expect(screen.queryByTestId("taxon-tree")).toBeNull();
    expect(screen.queryByTestId("sample-view-message")).toBeNull();
  });

  it("renders the tree view instead of the table when view is tree", () => {
    renderReport({ view: "tree" });
    expect(screen.getByTestId("taxon-tree")).toBeTruthy();
    expect(screen.queryByTestId("report-table")).toBeNull();
  });

  it("does not render the tree when in tree view but there is no filtered data", () => {
    renderReport({ view: "tree", filteredReportData: [] });
    expect(screen.queryByTestId("taxon-tree")).toBeNull();
    // Filters still render because the report is otherwise ready.
    expect(screen.getByTestId("report-filters")).toBeTruthy();
  });

  it("falls back to SampleViewMessage when the report is not ready", () => {
    renderReport({ reportMetadata: { reportReady: false } });
    expect(screen.getByTestId("sample-view-message")).toBeTruthy();
    expect(screen.queryByTestId("report-filters")).toBeNull();
  });

  it("falls back to SampleViewMessage while the report is loading", () => {
    renderReport({ loadingReport: true });
    expect(screen.getByTestId("sample-view-message")).toBeTruthy();
    expect(mockMessageProps.loadingReport).toBe(true);
  });

  it("flags the zero-taxon case when the ready report has no rows", () => {
    renderReport({ reportData: [], filteredReportData: [] });
    expect(screen.getByTestId("sample-view-message")).toBeTruthy();
    expect(mockMessageProps.hasZeroTaxons).toBe(true);
  });
});

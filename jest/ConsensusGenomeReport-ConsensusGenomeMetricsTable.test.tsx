// Coverage: app/assets/src/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeReport/components/ConsensusGenomeMetricsTable/ConsensusGenomeMetricsTable.tsx
//
// The component reads a Relay fragment and builds the quality-metrics column set
// for a virtualized Table. Its branching lives in the guard clauses (null
// fragment, and the data-retention "taxon name but no percentIdentity" case) and
// in computeQualityMetricColumns, which assigns a default cell renderer to
// columns that lack one and pulls labels from FIELDS_METADATA. useFragment is
// stubbed to pass the fixture through, and the Table is stubbed so the computed
// columns and the single data row can be asserted -- including exercising each
// column's cellRenderer (percent vs plain).
import { render, screen } from "@testing-library/react";

jest.mock(
  "~/components/views/SampleView/components/ConsensusGenomeView/consensus_genome_view.scss",
  () => ({}),
  { virtual: true },
);

jest.mock(
  "~/components/common/SampleMessage/sample_message.scss",
  () => ({}),
  { virtual: true },
);

jest.mock("react-relay", () => ({
  graphql: () => ({}),
  useFragment: (_fragment: unknown, key: unknown) => key,
}));

jest.mock("~/components/ui/containers", () => ({
  HelpIcon: ({ text }: $TSFixMe) => <span data-testid="help-icon">{text}</span>,
}));

let mockTableProps: $TSFixMe = null;
jest.mock("~/components/visualizations/table", () => ({
  Table: (props: $TSFixMe) => {
    mockTableProps = props;
    return <div data-testid="metrics-table" />;
  },
}));

import {
  CONSENSUS_GENOME_METRICS_EXPIRED_MESSAGE,
  ConsensusGenomeMetricsTable,
} from "~/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeReport/components/ConsensusGenomeMetricsTable/ConsensusGenomeMetricsTable";

const fullMetrics = {
  mappedReads: 100000,
  nActg: 29000,
  nAmbiguous: 5,
  nMissing: 12,
  refSnps: 3,
  percentIdentity: 99.9,
  gcPercent: 37.5,
  percentGenomeCalled: 98.2,
};

const makeData = (overrides: $TSFixMe = {}) => [
  {
    taxon: { name: "SARS-CoV-2" },
    metrics: { ...fullMetrics },
    ...overrides,
  },
];

const renderComponent = (data: $TSFixMe) =>
  render(
    <ConsensusGenomeMetricsTable
      helpLinkUrl="https://help.example.com"
      workflowRunResultsData={data}
    />,
  );

beforeEach(() => {
  mockTableProps = null;
});

describe("ConsensusGenomeMetricsTable", () => {
  it("renders nothing when the fragment resolves to null", () => {
    const { container } = renderComponent(null);
    expect(container.firstChild).toBeNull();
  });

  it("shows the data-retention message (not a blank screen) when there is a taxon name but no percentIdentity", () => {
    // SMP-1817: an expired consensus genome (metrics aged out of the retention
    // window) must surface a user-facing message instead of rendering nothing.
    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    renderComponent(
      makeData({ metrics: { ...fullMetrics, percentIdentity: undefined } }),
    );
    expect(
      screen.getByText(CONSENSUS_GENOME_METRICS_EXPIRED_MESSAGE),
    ).toBeTruthy();
    // The metrics table itself is not rendered in the expired case.
    expect(screen.queryByTestId("metrics-table")).toBeNull();
    // The developer-facing warning is still emitted.
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("renders the table and passes the metrics as a single data row", () => {
    renderComponent(makeData());
    expect(screen.getByText("Is my consensus genome complete?")).toBeTruthy();
    expect(screen.getByTestId("metrics-table")).toBeTruthy();
    expect(mockTableProps.data).toHaveLength(1);
    expect(mockTableProps.data[0].taxonName).toBe("SARS-CoV-2");
    expect(mockTableProps.data[0].mappedReads).toBe(100000);
  });

  it("computes columns and assigns a default cell renderer to columns without one", () => {
    renderComponent(makeData());
    const columns = mockTableProps.columns;
    const mappedReadsCol = columns.find(
      (c: $TSFixMe) => c.dataKey === "mappedReads",
    );
    // mappedReads has no explicit cellRenderer, so it gets the default one.
    expect(typeof mappedReadsCol.cellRenderer).toBe("function");
    expect(mappedReadsCol.flexGrow).toBe(1);
  });

  it("renders a percent suffix through the percent cell renderer", () => {
    renderComponent(makeData());
    const gcCol = mockTableProps.columns.find(
      (c: $TSFixMe) => c.dataKey === "gcPercent",
    );
    const { container } = render(gcCol.cellRenderer({ cellData: "37.5" }));
    expect(container.textContent).toBe("37.5%");
  });

  it("renders no percent suffix through the default cell renderer", () => {
    renderComponent(makeData());
    const readsCol = mockTableProps.columns.find(
      (c: $TSFixMe) => c.dataKey === "mappedReads",
    );
    const { container } = render(readsCol.cellRenderer({ cellData: "100000" }));
    expect(container.textContent).toBe("100000");
  });
});

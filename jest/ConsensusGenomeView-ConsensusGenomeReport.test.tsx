// Coverage for
// app/assets/src/components/views/SampleView/components/ConsensusGenomeView/
//   components/ConsensusGenomeReport/ConsensusGenomeReport.tsx
//
// The report runs a Relay query for the workflow run's consensus genomes and
// then: bails out with `null` when the query returns nothing, strips null
// entries out of the returned list, picks the SARS-CoV-2 vs generic viral help
// link off the run's accession id, and hands both the metrics table and the
// coverage view the surviving rows inside a SampleReportContent shell.
//
// relay-test-utils is not installed, so useLazyLoadQuery is stubbed to return a
// per-test payload while recording the variables it was called with. The two
// child views and the SampleReportContent shell are stubbed to minimal DOM so
// the props this component computes are directly observable.
import { render, screen } from "@testing-library/react";

jest.mock(
  "~/components/views/SampleView/components/ConsensusGenomeView/consensus_genome_view.scss",
  () => ({ resultsContainer: "resultsContainer" }),
  { virtual: true },
);

const mockUseLazyLoadQuery = jest.fn();
jest.mock("react-relay", () => ({
  graphql: () => ({}),
  useLazyLoadQuery: (...args: unknown[]) => mockUseLazyLoadQuery(...args),
}));

jest.mock(
  "~/components/views/SampleView/components/SampleReportConent",
  () => ({
    SampleReportContent: ({
      children,
      loadingResults,
      loadingInfo,
      eventNames,
      sample,
      workflowRun,
    }: $TSFixMe) => (
      <div data-testid="report-content">
        <span data-testid="loading-results">{String(loadingResults)}</span>
        <span data-testid="loading-help-link">{loadingInfo.helpLink}</span>
        <span data-testid="loading-message">{loadingInfo.message}</span>
        <span data-testid="loading-link-text">{loadingInfo.linkText}</span>
        <span data-testid="event-error">{eventNames.error}</span>
        <span data-testid="event-loading">{eventNames.loading}</span>
        <span data-testid="sample-id">{String(sample.id)}</span>
        <span data-testid="run-id">{String(workflowRun.id)}</span>
        {children}
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeReport/components/ConsensusGenomeMetricsTable",
  () => ({
    ConsensusGenomeMetricsTable: ({
      helpLinkUrl,
      workflowRunResultsData,
    }: $TSFixMe) => (
      <div data-testid="metrics-table" data-help-link={helpLinkUrl}>
        {workflowRunResultsData.map((d: $TSFixMe) => d.id).join(",")}
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeReport/components/ConsensusGenomeCoverageView",
  () => ({
    ConsensusGenomeCoverageView: ({
      helpLinkUrl,
      sampleId,
      workflowRunResultsData,
    }: $TSFixMe) => (
      <div
        data-testid="coverage-view"
        data-help-link={helpLinkUrl}
        data-sample-id={String(sampleId)}
      >
        {String(workflowRunResultsData.length)}
      </div>
    ),
  }),
);

import { ConsensusGenomeReport } from "~/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeReport/ConsensusGenomeReport";

// SARS link is a legacy help.czid.org URL, intentionally untouched by SW-2 (SW-3).
const SARS_LINK = "https://help.czid.org/hc/en-us/articles/360049787632";
// SW-2: the viral CG doc link is now the "helpcenter:" sentinel (resolved by Link.tsx).
const VIRAL_LINK =
  "helpcenter:/articles/metagenomic-analysis-consensus-genome-quality-checks/";

const sample = { id: 42, name: "sample-42" } as $TSFixMe;

const makeRun = (accessionId?: string, id: $TSFixMe = 7) =>
  ({
    id,
    inputs: accessionId ? { accession_id: accessionId } : {},
  } as $TSFixMe);

const renderReport = (workflowRun: $TSFixMe = makeRun("OTHER.1")) =>
  render(<ConsensusGenomeReport sample={sample} workflowRun={workflowRun} />);

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLazyLoadQuery.mockReturnValue({
    fedConsensusGenomes: [{ id: "cg-1" }],
  });
});

describe("ConsensusGenomeReport -- query wiring", () => {
  it("queries with the workflow run id as a string", () => {
    renderReport(makeRun("OTHER.1", 7));
    expect(mockUseLazyLoadQuery.mock.calls[0][1]).toEqual({
      workflowRunId: "7",
    });
  });

  it("sends an undefined run id when the workflow run has none", () => {
    renderReport({ inputs: {} } as $TSFixMe);
    expect(mockUseLazyLoadQuery.mock.calls[0][1]).toEqual({
      workflowRunId: undefined,
    });
  });
});

describe("ConsensusGenomeReport -- empty query results", () => {
  it("renders nothing when the query returns null genomes", () => {
    mockUseLazyLoadQuery.mockReturnValue({ fedConsensusGenomes: null });
    const { container } = renderReport();
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("report-content")).toBeNull();
  });

  it("renders nothing when the field is absent entirely", () => {
    mockUseLazyLoadQuery.mockReturnValue({});
    const { container } = renderReport();
    expect(container.innerHTML).toBe("");
  });

  it("still renders the shell and children for an empty (but non-null) list", () => {
    mockUseLazyLoadQuery.mockReturnValue({ fedConsensusGenomes: [] });
    renderReport();
    expect(screen.getByTestId("report-content")).toBeTruthy();
    expect(screen.getByTestId("coverage-view").textContent).toBe("0");
    expect(screen.getByTestId("metrics-table").textContent).toBe("");
  });
});

describe("ConsensusGenomeReport -- results", () => {
  it("filters null entries out of the returned genome list", () => {
    mockUseLazyLoadQuery.mockReturnValue({
      fedConsensusGenomes: [{ id: "cg-1" }, null, { id: "cg-2" }, undefined],
    });
    renderReport();
    expect(screen.getByTestId("metrics-table").textContent).toBe("cg-1,cg-2");
    expect(screen.getByTestId("coverage-view").textContent).toBe("2");
  });

  it("passes the sample id down to the coverage view", () => {
    renderReport();
    expect(
      screen.getByTestId("coverage-view").getAttribute("data-sample-id"),
    ).toBe("42");
    expect(screen.getByTestId("sample-id").textContent).toBe("42");
    expect(screen.getByTestId("run-id").textContent).toBe("7");
  });

  it("tells SampleReportContent not to show its own loading state", () => {
    renderReport();
    expect(screen.getByTestId("loading-results").textContent).toBe("false");
    expect(screen.getByTestId("loading-message").textContent).toBe(
      "Your Consensus Genome is being generated!",
    );
    expect(screen.getByTestId("loading-link-text").textContent).toBe(
      "Learn about Consensus Genomes",
    );
    expect(screen.getByTestId("event-error").textContent).toBe(
      "ConsensusGenomeView_sample-error-info-link_clicked",
    );
    expect(screen.getByTestId("event-loading").textContent).toBe(
      "ConsensusGenomeView_consenus-genome-doc-link_clicked",
    );
  });
});

describe("ConsensusGenomeReport -- help link selection", () => {
  it("uses the SARS-CoV-2 doc link for the SARS-CoV-2 accession", () => {
    renderReport(makeRun("MN908947.3"));
    expect(
      screen.getByTestId("metrics-table").getAttribute("data-help-link"),
    ).toBe(SARS_LINK);
    expect(
      screen.getByTestId("coverage-view").getAttribute("data-help-link"),
    ).toBe(SARS_LINK);
    expect(screen.getByTestId("loading-help-link").textContent).toBe(SARS_LINK);
  });

  it("uses the generic viral doc link for any other accession", () => {
    renderReport(makeRun("MZ026853.1"));
    expect(
      screen.getByTestId("metrics-table").getAttribute("data-help-link"),
    ).toBe(VIRAL_LINK);
  });

  it("uses the generic viral doc link when the run has no accession input", () => {
    renderReport(makeRun(undefined));
    expect(screen.getByTestId("loading-help-link").textContent).toBe(
      VIRAL_LINK,
    );
  });
});

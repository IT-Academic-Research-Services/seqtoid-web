// Coverage: app/assets/src/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeReport/components/ConsensusGenomeCoverageView/ConsensusGenomeCoverageView.tsx
//
// The component reads a Relay fragment (plural) and renders a "How good is the
// coverage?" metrics panel plus a histogram. Its branching lives in the guard
// clauses (null fragment, missing coverage metrics) and in the accessionId
// switch between the NCBI reference link and a custom-reference download button.
// relay-test-utils is not installed, so useFragment is stubbed to hand back the
// fixture, and the heavy children (histogram, popups, links, sds Button/Icon)
// are stubbed to minimal DOM so the metric values and the download callback can
// be asserted directly.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock(
  "~/components/views/SampleView/components/ConsensusGenomeView/consensus_genome_view.scss",
  () => ({}),
  { virtual: true },
);

jest.mock("react-relay", () => ({
  graphql: () => ({}),
  useFragment: (_fragment: unknown, key: unknown) => key,
}));

const mockOpenUrlInNewTab = jest.fn();
jest.mock("~/components/utils/links", () => ({
  openUrlInNewTab: (...args: unknown[]) => mockOpenUrlInNewTab(...args),
}));

jest.mock("~/components/common/BasicPopup", () => ({
  __esModule: true,
  default: ({ trigger }: $TSFixMe) => <div data-testid="popup">{trigger}</div>,
}));

jest.mock("~/components/ui/controls/ExternalLink", () => ({
  __esModule: true,
  default: ({ href, children }: $TSFixMe) => <a href={href}>{children}</a>,
}));

jest.mock("~/components/ui/containers", () => ({
  HelpIcon: ({ text }: $TSFixMe) => <span data-testid="help-icon">{text}</span>,
}));

jest.mock(
  "~/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeReport/components/ConsensusGenomeCoverageView/components/ConsensusGenomeHistogram/ConsensusGenomeHistogram",
  () => ({
    ConsensusGenomeHistogram: () => <div data-testid="histogram" />,
  }),
);

jest.mock("@czi-sds/components", () => ({
  __esModule: true,
  Button: ({ children, onClick }: $TSFixMe) => (
    <button data-testid="download-button" onClick={onClick}>
      {children}
    </button>
  ),
  Icon: () => <span data-testid="icon" />,
}));

import { ConsensusGenomeCoverageView } from "~/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeReport/components/ConsensusGenomeCoverageView/ConsensusGenomeCoverageView";

const baseMetrics = {
  coverageBreadth: 0.95,
  coverageDepth: 42.345,
  coverageTotalLength: 29903,
};

const makeData = (overrides: $TSFixMe = {}) => [
  {
    accession: { accessionId: "MN908947.3" },
    taxon: { name: "SARS-CoV-2", id: "2697049" },
    metrics: { ...baseMetrics },
    referenceGenome: {
      file: { downloadLink: { url: "https://example.com/ref.fasta" } },
    },
    ...overrides,
  },
];

const renderComponent = (data: $TSFixMe) =>
  render(
    <ConsensusGenomeCoverageView
      helpLinkUrl="https://help.example.com"
      sampleId={"123" as $TSFixMe}
      workflowRun={{} as $TSFixMe}
      workflowRunResultsData={data}
    />,
  );

beforeEach(() => {
  mockOpenUrlInNewTab.mockClear();
});

describe("ConsensusGenomeCoverageView", () => {
  it("renders nothing when the fragment resolves to null", () => {
    const { container } = renderComponent(null);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the coverage metrics are missing", () => {
    const { container } = renderComponent(
      makeData({
        metrics: {
          coverageBreadth: 0,
          coverageDepth: 0,
          coverageTotalLength: 0,
        },
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the coverage panel and formatted metric values", () => {
    renderComponent(makeData());
    expect(screen.getByText("How good is the coverage?")).toBeTruthy();
    expect(screen.getByTestId("histogram")).toBeTruthy();
    // coverageDepth is toFixed(1) with an "x" suffix.
    expect(screen.getByText("42.3x")).toBeTruthy();
    // referenceLength renders the raw total length.
    expect(screen.getByText("29903")).toBeTruthy();
  });

  it("renders the NCBI reference link when an accession id is present", () => {
    renderComponent(makeData());
    const link = screen.getByRole("link", { name: "MN908947.3" });
    expect(link.getAttribute("href")).toContain(
      "ncbi.nlm.nih.gov/nuccore/MN908947.3",
    );
    expect(screen.queryByTestId("download-button")).toBeNull();
  });

  it("renders a custom-reference download button when there is no accession id", () => {
    renderComponent(makeData({ accession: { accessionId: null } }));
    expect(screen.getByTestId("download-button")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("opens the reference file in a new tab when the download button is clicked", () => {
    renderComponent(makeData({ accession: { accessionId: null } }));
    fireEvent.click(screen.getByTestId("download-button"));
    expect(mockOpenUrlInNewTab).toHaveBeenCalledWith(
      "https://example.com/ref.fasta",
    );
  });

  it("does not open a tab when the reference file has no download url", () => {
    renderComponent(
      makeData({
        accession: { accessionId: null },
        referenceGenome: { file: { downloadLink: { url: null } } },
      }),
    );
    fireEvent.click(screen.getByTestId("download-button"));
    expect(mockOpenUrlInNewTab).not.toHaveBeenCalled();
  });
});

// Coverage: app/assets/src/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeReport/components/ConsensusGenomeCoverageView/components/ConsensusGenomeHistogram/ConsensusGenomeHistogram.tsx
//
// The component reads a Relay fragment, derives the D3 histogram options from
// the coverage metrics and owns a hover tooltip. relay-test-utils is not
// installed, so useFragment is stubbed to hand back whatever fixture the test
// passes as workflowRunResultsData, and the D3 Histogram class is stubbed so the
// options object (labels, domain, bin count) can be asserted and the
// onHistogramBar* callbacks invoked directly -- that is the only route into the
// tooltip builder.
import { act, fireEvent, render, screen } from "@testing-library/react";

// jest.config maps the webpack "~" alias before the css/scss rule, so a scss
// file imported through "~/..." resolves to the real file and fails to parse.
jest.mock(
  "~/components/views/SampleView/components/ConsensusGenomeView/consensus_genome_view.scss",
  () => ({}),
  { virtual: true },
);

const mockHistogramConstructor = jest.fn();
const mockHistogramUpdate = jest.fn();

jest.mock("react-relay", () => ({
  graphql: () => ({}),
  // The fixture is passed straight through as the fragment key.
  useFragment: (_fragment: unknown, key: unknown) => key,
}));

jest.mock("~/components/visualizations/Histogram", () => ({
  __esModule: true,
  default: class MockHistogram {
    constructor(container: unknown, data: unknown, options: unknown) {
      mockHistogramConstructor(container, data, options);
    }
    update() {
      mockHistogramUpdate();
    }
  },
  HISTOGRAM_SCALE: { SYM_LOG: "symLog", LIN: "linear", LOG: "log" },
}));

import { ConsensusGenomeHistogram } from "~/components/views/SampleView/components/ConsensusGenomeView/components/ConsensusGenomeReport/components/ConsensusGenomeCoverageView/components/ConsensusGenomeHistogram/ConsensusGenomeHistogram";
import { CreationSource } from "~/interface/sample";

// coverageViz rows are [binIndex, avgDepth, breadth, nContigs, nReads].
const COVERAGE_VIZ = [
  [0, 12, 0.5, 1, 30],
  [1, 40, 0.9, 2, 90],
];

const makeData = (overrides: $TSFixMe = {}) => [
  {
    accession: { accessionId: "MN908947.3", accessionName: "SARS-CoV-2" },
    taxon: { name: "Severe acute respiratory syndrome coronavirus 2" },
    metrics: {
      coverageViz: COVERAGE_VIZ,
      coverageBinSize: 100,
      coverageTotalLength: 200,
    },
    ...overrides,
  },
];

const workflowRun = (inputs: $TSFixMe) => ({ inputs } as $TSFixMe);

const renderComponent = (data: $TSFixMe, inputs: $TSFixMe = {}) =>
  render(
    <ConsensusGenomeHistogram
      workflowRun={workflowRun(inputs)}
      workflowRunResultsData={data}
    />,
  );

const histogramOptions = () => mockHistogramConstructor.mock.calls[0][2];

beforeEach(() => {
  mockHistogramConstructor.mockClear();
  mockHistogramUpdate.mockClear();
});

describe("ConsensusGenomeHistogram", () => {
  it("renders nothing when the fragment resolves to null", () => {
    const { container } = renderComponent(null);
    expect(container.firstChild).toBeNull();
    expect(mockHistogramConstructor).not.toHaveBeenCalled();
  });

  it("builds the histogram from the coverage metrics", () => {
    renderComponent(makeData());

    expect(mockHistogramConstructor).toHaveBeenCalledTimes(1);
    expect(mockHistogramUpdate).toHaveBeenCalledTimes(1);

    const [container, series, options] = mockHistogramConstructor.mock.calls[0];
    expect(container).toBeInstanceOf(HTMLElement);
    // x0 is the bin index scaled by the bin size; length is the bar height.
    expect(series).toEqual([
      [
        { x0: 0 && 100, length: 12 },
        { x0: 100, length: 40 },
      ],
    ]);
    expect(options.domain).toEqual([0, 200]);
    expect(options.numBins).toBe(2);
    expect(options.labelX).toBe("Reference Sequence");
    expect(options.labelY).toBe("Coverage (SymLog)");
    expect(options.yScaleType).toBe("symLog");
    expect(options.skipBins).toBe(true);
  });

  it("labels the x axis with the accession id and name", () => {
    renderComponent(makeData());
    expect(histogramOptions().labelXSubtext).toBe("MN908947.3 - SARS-CoV-2");
  });

  it("falls back to the taxon name when the accession has no name", () => {
    renderComponent(
      makeData({ accession: { accessionId: "ABC123", accessionName: null } }),
    );
    expect(histogramOptions().labelXSubtext).toBe(
      "ABC123 - Severe acute respiratory syndrome coronavirus 2",
    );
  });

  it("falls back to placeholder text when neither accession nor taxon is named", () => {
    renderComponent(
      makeData({
        accession: { accessionId: null, accessionName: null },
        taxon: null,
      }),
    );
    expect(histogramOptions().labelXSubtext).toBe(
      "Unknown accession - Unknown taxon",
    );
  });

  it("uses the reference fasta as the subtext for a WGS run", () => {
    renderComponent(makeData(), {
      creation_source: CreationSource.WGS,
      ref_fasta: "my-reference.fasta",
    });
    expect(histogramOptions().labelXSubtext).toBe("my-reference.fasta");
  });

  it("still renders when the workflow run has no inputs", () => {
    renderComponent(makeData(), undefined);
    expect(histogramOptions().labelXSubtext).toBe("MN908947.3 - SARS-CoV-2");
  });

  it("does not build a histogram when there is no coverage data", () => {
    renderComponent([
      {
        accession: { accessionId: "ABC", accessionName: "abc" },
        taxon: { name: "taxon" },
        metrics: {
          coverageViz: null,
          coverageBinSize: null,
          coverageTotalLength: null,
        },
      },
    ]);
    expect(mockHistogramConstructor).not.toHaveBeenCalled();
  });

  it("does not build a histogram when the fragment returns an empty list", () => {
    const { container } = renderComponent([]);
    expect(mockHistogramConstructor).not.toHaveBeenCalled();
    // The container div is still rendered, just empty.
    expect(container.querySelectorAll("div").length).toBeGreaterThan(0);
  });
});

describe("ConsensusGenomeHistogram tooltip", () => {
  const enterAndHover = (barIndex: number) => {
    const options = histogramOptions();
    act(() => {
      options.onHistogramBarEnter([0, barIndex]);
      options.onHistogramBarHover(120, 240);
    });
    return options;
  };

  it("shows coverage details for the hovered bar", () => {
    renderComponent(makeData());
    enterAndHover(1);

    expect(screen.getByText("Coverage")).toBeTruthy();
    expect(screen.getByText("Base Pair Range")).toBeTruthy();
    // bin index 1, bin size 100 -> 100-200 (en-dash)
    expect(screen.getByText("100–200")).toBeTruthy();
    expect(screen.getByText("40x")).toBeTruthy();
    expect(screen.getByText("90.0%")).toBeTruthy();
  });

  it("reports N/A for the base pair range of the zeroth bin", () => {
    renderComponent(makeData());
    enterAndHover(0);

    expect(screen.getByText("N/A")).toBeTruthy();
    expect(screen.getByText("12x")).toBeTruthy();
    expect(screen.getByText("50.0%")).toBeTruthy();
  });

  it("reports N/A for every field when the bin is missing", () => {
    renderComponent(makeData());
    enterAndHover(99);

    expect(screen.getAllByText("N/A")).toHaveLength(3);
  });

  it("does not open a tooltip when the hover is not on the first series", () => {
    renderComponent(makeData());
    const options = histogramOptions();
    act(() => {
      options.onHistogramBarEnter([1, 1]);
      options.onHistogramBarHover(120, 240);
    });
    expect(screen.queryByText("Base Pair Range")).toBeNull();
  });

  it("hides the tooltip on bar exit and on mouse leave", () => {
    const { container } = renderComponent(makeData());
    const options = enterAndHover(1);
    expect(screen.getByText("Base Pair Range")).toBeTruthy();

    act(() => {
      options.onHistogramBarExit();
    });
    expect(screen.queryByText("Base Pair Range")).toBeNull();

    enterAndHover(1);
    expect(screen.getByText("Base Pair Range")).toBeTruthy();
    fireEvent.mouseLeave(container.firstChild as HTMLElement);
    expect(screen.queryByText("Base Pair Range")).toBeNull();
  });
});

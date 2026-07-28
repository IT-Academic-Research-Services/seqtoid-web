// Branch coverage for
// app/assets/src/components/common/CoverageVizBottomSidebar/CoverageVizBottomSidebar.tsx
//
// The main spec always mounts with (or transitions into) a populated
// best_accessions list on the short-read workflow, which leaves these
// conditionals unexercised:
//
//   * `setCurrentAccession`'s `accessionId ? find(...) : null` fallback and the
//     `if (accession)` guard -- reached when accession data arrives with an
//     empty best_accessions list, so there is no id to select
//   * the `isReadLevelVizAvailable ? ... : ""` arm of the omitted-accessions
//     help text, used by every workflow except short-read mNGS
//   * `getAccessionMetrics`'s `if (!currentAccessionData) return {}` guard
import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { getCoverageVizData } from "~/api";
import CoverageVizBottomSidebar from "~/components/common/CoverageVizBottomSidebar/CoverageVizBottomSidebar";
import { WorkflowType } from "~/components/utils/workflows";

jest.mock("~/components/visualizations/GenomeViz", () => {
  class MockGenomeViz {
    update = jest.fn();
    outlineBar = jest.fn();
  }
  return { __esModule: true, default: MockGenomeViz };
});

jest.mock("~/components/visualizations/Histogram", () => {
  class MockHistogram {
    update = jest.fn();
  }
  return { __esModule: true, default: MockHistogram };
});

jest.mock("~/api", () => ({
  getCoverageVizData: jest.fn(),
  getContigsSequencesByByteranges: jest.fn(),
}));

// HelpIcon keeps its tooltip copy out of the DOM, so surface the text prop to
// assert on which variant of the help string was built.
jest.mock("~ui/containers/HelpIcon", () => ({
  __esModule: true,
  default: ({ text }: $TSFixMe) => <div data-testid="help-text">{text}</div>,
}));

const mockedGetCoverageVizData = getCoverageVizData as jest.MockedFunction<
  typeof getCoverageVizData
>;

const accessionA = {
  id: "ACC_A",
  num_contigs: 2,
  num_reads: 3,
  name: "Accession A",
  score: 9,
  coverage_depth: 12,
  coverage_breadth: 0.5,
  taxon_name: "Species A",
  taxon_common_name: "species a",
};

const loadedAccessionData = {
  coverage: [
    [0, 12, 0.5, 2, 3],
    [1, 4, 0.25, 0, 1],
  ],
  coverage_bin_size: 100,
  total_length: 1000,
  max_aligned_length: 800,
  coverage_depth: 12.5,
  coverage_breadth: 0.42,
  avg_prop_mismatch: 0.03,
  hit_groups: [[2, 0, 40, 100, 900, 800, 0.97, 4, 1, 0, [[10, 30]]]],
};

const makeParams = (accessionData: $TSFixMe) => ({
  taxonId: 555,
  taxonName: "Genus X",
  taxonCommonName: "genus x common",
  taxonLevel: "species",
  taxonStatsByCountType: {
    ntContigs: 2,
    ntReads: 4,
    nrContigs: 0,
    nrReads: 0,
  },
  accessionData,
});

const baseProps = {
  visible: true,
  onClose: jest.fn(),
  onBlastClick: jest.fn(),
  sampleId: 123,
  pipelineVersion: "8.0.0",
  wdlVersion: "8.0.0",
  nameType: "Scientific Name",
  workflow: WorkflowType.SHORT_READ_MNGS,
};

beforeEach(() => {
  mockedGetCoverageVizData.mockReset();
  mockedGetCoverageVizData.mockResolvedValue(loadedAccessionData as $TSFixMe);
});

describe("CoverageVizBottomSidebar accession selection", () => {
  it("selects nothing when accession data arrives with no viewable accessions", async () => {
    const view = render(
      <CoverageVizBottomSidebar {...baseProps} params={{} as $TSFixMe} />,
    );

    // The accession data resolves, but every accession was filtered out, so the
    // sorted list has no id to select and no fetch is issued.
    await act(async () => {
      view.rerender(
        <CoverageVizBottomSidebar
          {...baseProps}
          params={
            makeParams({ best_accessions: [], num_accessions: 4 }) as $TSFixMe
          }
        />,
      );
    });

    expect(mockedGetCoverageVizData).not.toHaveBeenCalled();
    expect(
      screen.getByText(/only available for taxa with at least one assembled/),
    ).toBeTruthy();
  });

  it("still selects and loads an accession when one is available", async () => {
    const view = render(
      <CoverageVizBottomSidebar {...baseProps} params={{} as $TSFixMe} />,
    );

    await act(async () => {
      view.rerender(
        <CoverageVizBottomSidebar
          {...baseProps}
          params={
            makeParams({
              best_accessions: [accessionA],
              num_accessions: 1,
            }) as $TSFixMe
          }
        />,
      );
    });

    expect(mockedGetCoverageVizData).toHaveBeenCalledWith(
      expect.objectContaining({ accessionId: "ACC_A" }),
    );
  });
});

describe("CoverageVizBottomSidebar omitted-accession help text", () => {
  it("omits the read-level pointer for workflows without a read-level viz", async () => {
    const view = render(
      <CoverageVizBottomSidebar
        {...baseProps}
        workflow={WorkflowType.LONG_READ_MNGS}
        params={{} as $TSFixMe}
      />,
    );

    await act(async () => {
      view.rerender(
        <CoverageVizBottomSidebar
          {...baseProps}
          workflow={WorkflowType.LONG_READ_MNGS}
          params={
            makeParams({
              best_accessions: [accessionA],
              num_accessions: 4,
            }) as $TSFixMe
          }
        />,
      );
    });

    const helpText = screen.getByTestId("help-text").textContent as string;
    expect(helpText).toContain("3 poor-quality accessions are omitted");
    // Long-read mNGS has no read-level visualization to point at.
    expect(helpText).not.toContain("read-level visualization");
  });

  it("keeps the read-level pointer for short-read mNGS", async () => {
    const view = render(
      <CoverageVizBottomSidebar {...baseProps} params={{} as $TSFixMe} />,
    );

    await act(async () => {
      view.rerender(
        <CoverageVizBottomSidebar
          {...baseProps}
          params={
            makeParams({
              best_accessions: [accessionA],
              num_accessions: 4,
            }) as $TSFixMe
          }
        />,
      );
    });

    expect(screen.getByTestId("help-text").textContent).toContain(
      "To see them, go to the read-level visualization.",
    );
  });
});

describe("CoverageVizBottomSidebar metrics guard", () => {
  it("returns no metrics before any accession data has loaded", () => {
    // getAccessionMetrics is defensive: the render path bails out earlier when
    // currentAccessionData is missing, so drive the guard through the instance.
    const ref = createRef<$TSFixMe>();
    render(
      <CoverageVizBottomSidebar
        {...baseProps}
        ref={ref}
        params={{} as $TSFixMe}
      />,
    );

    expect(ref.current.state.currentAccessionData).toBeUndefined();
    expect(ref.current.getAccessionMetrics(7)).toEqual({});
  });
});

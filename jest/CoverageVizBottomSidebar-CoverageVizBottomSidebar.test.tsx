// Frontend coverage: CoverageVizBottomSidebar is the bottom drawer that shows
// per-accession coverage for a taxon. It owns accession selection + caching,
// the metric grid, the histogram/reference-accession D3 views and the
// hover tooltip. The two D3 classes (Histogram, GenomeViz) are stubbed so the
// tests can invoke the exact callbacks the real charts fire and assert on
// React output rather than on SVG internals.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { getCoverageVizData } from "~/api";
import CoverageVizBottomSidebar from "~/components/common/CoverageVizBottomSidebar/CoverageVizBottomSidebar";
import { WorkflowType } from "~/components/utils/workflows";
import GenomeViz from "~/components/visualizations/GenomeViz";
import Histogram from "~/components/visualizations/Histogram";

jest.mock("~/components/visualizations/GenomeViz", () => {
  const instances: $TSFixMe[] = [];
  class MockGenomeViz {
    container: $TSFixMe;
    data: $TSFixMe;
    options: $TSFixMe;
    update = jest.fn();
    outlineBar = jest.fn();
    constructor(container: $TSFixMe, data: $TSFixMe, options: $TSFixMe) {
      this.container = container;
      this.data = data;
      this.options = options;
      instances.push(this);
    }
  }
  (MockGenomeViz as $TSFixMe).__instances = instances;
  return { __esModule: true, default: MockGenomeViz };
});

jest.mock("~/components/visualizations/Histogram", () => {
  const instances: $TSFixMe[] = [];
  class MockHistogram {
    container: $TSFixMe;
    data: $TSFixMe;
    options: $TSFixMe;
    update = jest.fn();
    constructor(container: $TSFixMe, data: $TSFixMe, options: $TSFixMe) {
      this.container = container;
      this.data = data;
      this.options = options;
      instances.push(this);
    }
  }
  (MockHistogram as $TSFixMe).__instances = instances;
  return { __esModule: true, default: MockHistogram };
});

jest.mock("~/api", () => ({
  getCoverageVizData: jest.fn(),
  getContigsSequencesByByteranges: jest.fn(),
}));

const mockedGetCoverageVizData = getCoverageVizData as jest.MockedFunction<
  typeof getCoverageVizData
>;

const genomeVizInstances = () =>
  (GenomeViz as $TSFixMe).__instances as $TSFixMe[];
const histogramInstances = () =>
  (Histogram as $TSFixMe).__instances as $TSFixMe[];

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

// coverage_breadth 0 exercises the falsy arm of the dropdown subtext.
const accessionB = {
  id: "ACC_B",
  num_contigs: 0,
  num_reads: 1,
  name: "Accession B",
  score: 1,
  coverage_depth: 1,
  coverage_breadth: 0,
  taxon_name: "Species B",
  taxon_common_name: "species b",
};

// [numContigs, numReads, contigR, start, end, alignLen, percentId,
//  mismatches, gaps, binIndex, contigByteranges]
const contigHitGroup = [2, 0, 40, 100, 900, 800, 0.97, 4, 1, 0, [[10, 30]]];
const readHitGroup = [0, 3, 0, 50, 60, 10, 0.8, 0, 0, 1, []];

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
  hit_groups: [contigHitGroup, readHitGroup],
};

const makeParams = (overrides = {}) => ({
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
  accessionData: {
    best_accessions: [accessionA, accessionB],
    num_accessions: 5,
  },
  ...overrides,
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

// The component only loads an accession from componentDidUpdate, so mount with
// no accession data first and then feed it in -- exactly what the sample report
// does when the coverage viz request resolves.
const renderAndLoad = async (props = {}, params = makeParams()) => {
  const view = render(
    <CoverageVizBottomSidebar {...baseProps} {...props} params={{}} />,
  );
  await act(async () => {
    view.rerender(
      <CoverageVizBottomSidebar {...baseProps} {...props} params={params} />,
    );
  });
  return view;
};

describe("CoverageVizBottomSidebar", () => {
  beforeEach(() => {
    genomeVizInstances().length = 0;
    histogramInstances().length = 0;
    mockedGetCoverageVizData.mockReset();
    mockedGetCoverageVizData.mockResolvedValue(loadedAccessionData as $TSFixMe);
    (baseProps.onBlastClick as jest.Mock).mockReset();
  });

  describe("with no accessions", () => {
    it("renders the workflow-specific unavailable message", () => {
      render(
        <CoverageVizBottomSidebar
          {...baseProps}
          params={makeParams({ accessionData: undefined }) as $TSFixMe}
        />,
      );
      expect(
        screen.getByText(/only available for taxa with at least one assembled/),
      ).toBeTruthy();
      // The no-data header still labels the taxon.
      expect(screen.getByText("Genus X Coverage")).toBeTruthy();
      expect(mockedGetCoverageVizData).not.toHaveBeenCalled();
    });

    it("renders the long-read message for the long-read workflow", () => {
      render(
        <CoverageVizBottomSidebar
          {...baseProps}
          workflow={WorkflowType.LONG_READ_MNGS}
          wdlVersion="0.7.5"
          params={{}}
        />,
      );
      expect(screen.getByText(/at least one assembled NT read/)).toBeTruthy();
    });

    it("treats an empty best_accessions list as no data", () => {
      render(
        <CoverageVizBottomSidebar
          {...baseProps}
          params={
            makeParams({
              accessionData: { best_accessions: [], num_accessions: 0 },
            }) as $TSFixMe
          }
        />,
      );
      expect(
        screen.getByText(/only available for taxa with at least one assembled/),
      ).toBeTruthy();
      expect(mockedGetCoverageVizData).not.toHaveBeenCalled();
    });
  });

  describe("before accession data resolves", () => {
    it("shows the loading message under a populated header", () => {
      mockedGetCoverageVizData.mockReturnValue(
        new Promise(() => undefined) as $TSFixMe,
      );
      render(
        <CoverageVizBottomSidebar
          {...baseProps}
          params={makeParams() as $TSFixMe}
        />,
      );
      expect(screen.getByText("Loading Visualization...")).toBeTruthy();
      expect(screen.getByText("2 viewable accessions")).toBeTruthy();
    });
  });

  describe("once the best accession loads", () => {
    it("requests the highest-scoring accession and renders its metrics", async () => {
      await renderAndLoad();

      expect(mockedGetCoverageVizData).toHaveBeenCalledWith({
        sampleId: "123",
        accessionId: "ACC_A",
        snapshotShareId: undefined,
        pipelineVersion: "8.0.0",
      });

      // Metric labels and the values built by getAccessionMetrics.
      expect(screen.getByText("Reference Length")).toBeTruthy();
      expect(screen.getByText("1000")).toBeTruthy();
      expect(screen.getByText("12.5x")).toBeTruthy();
      expect(screen.getByText("42.0%")).toBeTruthy();
      expect(screen.getByText("3.0%")).toBeTruthy();
      expect(screen.getByText("800")).toBeTruthy();
    });

    it("splits the hit groups into contig and loose-read rows", async () => {
      await renderAndLoad();
      // totalContigs comes from the accession summary, totalReads from the
      // read hit groups.
      expect(screen.getByText("NT Contigs (2)")).toBeTruthy();
      expect(screen.getByText("Loose NT Reads (3)")).toBeTruthy();
    });

    it("omits the loose-read row when no hit group has reads", async () => {
      mockedGetCoverageVizData.mockResolvedValue({
        ...loadedAccessionData,
        hit_groups: [contigHitGroup],
      } as $TSFixMe);
      await renderAndLoad();
      expect(screen.getByText("NT Contigs (2)")).toBeTruthy();
      expect(screen.queryByText(/Loose NT Reads/)).toBeNull();
    });

    it("builds the histogram and the reference-accession strip", async () => {
      await renderAndLoad();

      const histogram = histogramInstances()[0];
      expect(histogram).toBeDefined();
      expect(histogram.options.domain).toEqual([0, 1000]);
      expect(histogram.options.numBins).toBe(10);
      expect(histogram.data).toEqual([
        [
          { x0: 0, length: 12 },
          { x0: 100, length: 4 },
        ],
      ]);
      expect(histogram.update).toHaveBeenCalled();

      const refAccessionViz = genomeVizInstances().find(
        viz => viz.options.color === "#EAEAEA",
      );
      expect(refAccessionViz).toBeDefined();
      expect(refAccessionViz.data).toEqual([[0, 1000, 0]]);
    });

    it("shows the accession count with the omitted-accession help text", async () => {
      await renderAndLoad();
      expect(screen.getByText("2 viewable accessions")).toBeTruthy();
      expect(screen.getByText("(5 total)")).toBeTruthy();
    });

    it("hides the total-count hint when every accession is viewable", async () => {
      await renderAndLoad(
        {},
        makeParams({
          accessionData: {
            best_accessions: [accessionA, accessionB],
            num_accessions: 2,
          },
        }),
      );
      expect(screen.getByText("2 viewable accessions")).toBeTruthy();
      expect(screen.queryByText("(2 total)")).toBeNull();
    });

    it("renders the error body when the accession data has no coverage", async () => {
      mockedGetCoverageVizData.mockResolvedValue({} as $TSFixMe);
      await renderAndLoad();

      expect(
        screen.getByText(/we failed to load the coverage data/),
      ).toBeTruthy();
      expect(screen.getByText("Contact us for help")).toBeTruthy();
      // No charts are built for invalid data.
      expect(histogramInstances()).toHaveLength(0);
    });

    it("caches accession data so a repeat selection does not refetch", async () => {
      const view = await renderAndLoad();
      expect(mockedGetCoverageVizData).toHaveBeenCalledTimes(1);

      // A new accessionData object with the same best accession: the component
      // re-selects ACC_A, which is already in its cache.
      await act(async () => {
        view.rerender(
          <CoverageVizBottomSidebar
            {...baseProps}
            params={makeParams() as $TSFixMe}
          />,
        );
      });
      expect(mockedGetCoverageVizData).toHaveBeenCalledTimes(1);
    });
  });

  describe("taxon label", () => {
    it("names only the taxon for a species-level view", async () => {
      await renderAndLoad();
      expect(screen.getByText("Genus X Coverage")).toBeTruthy();
    });

    it("names the underlying species for a genus-level view", async () => {
      await renderAndLoad({}, makeParams({ taxonLevel: "genus" }));
      expect(screen.getByText(/Genus X Coverage\s*-\s*Species A/)).toBeTruthy();
    });

    it("uses the common name when the report is showing common names", async () => {
      await renderAndLoad({ nameType: "Common Name" });
      expect(screen.getByText("Genus x common Coverage")).toBeTruthy();
    });
  });

  describe("header actions", () => {
    it("disables BLAST when the taxon has no NT contigs", async () => {
      await renderAndLoad(
        {},
        makeParams({
          taxonStatsByCountType: {
            ntContigs: 0,
            ntReads: 4,
            nrContigs: 0,
            nrReads: 0,
          },
        }),
      );
      const blastButton = document.querySelectorAll("button")[0];
      expect(blastButton.hasAttribute("disabled")).toBe(true);
      fireEvent.click(blastButton);
      expect(baseProps.onBlastClick).not.toHaveBeenCalled();
    });

    it("calls onBlastClick with the sidebar context when contigs exist", async () => {
      await renderAndLoad();
      const blastButton = document.querySelectorAll("button")[0];
      expect(blastButton.hasAttribute("disabled")).toBe(false);
      fireEvent.click(blastButton);

      expect(baseProps.onBlastClick).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { blastedFrom: "CoverageVizBottomSidebar" },
          pipelineVersion: "8.0.0",
          sampleId: 123,
          taxName: "Genus X",
          taxId: 555,
          shouldBlastContigs: true,
        }),
      );
    });

    it("opens the contig FASTA download url", async () => {
      const openSpy = jest
        .spyOn(window, "open")
        .mockImplementation(() => null as $TSFixMe);
      try {
        await renderAndLoad();
        fireEvent.click(document.querySelectorAll("button")[1]);
        expect(openSpy).toHaveBeenCalledWith(
          "/samples/123/taxid_contigs_download?taxid=555&pipeline_version=8.0.0",
          "_self",
        );
      } finally {
        openSpy.mockRestore();
      }
    });

    it("hides the header actions on a snapshot share link", async () => {
      await renderAndLoad({ snapshotShareId: "share-1" });
      expect(document.querySelectorAll("button")).toHaveLength(0);
      expect(mockedGetCoverageVizData).toHaveBeenCalledWith(
        expect.objectContaining({ snapshotShareId: "share-1" }),
      );
    });
  });

  describe("histogram tooltip", () => {
    it("appears for a bar in the coverage series and clears on exit", async () => {
      await renderAndLoad();
      const { onHistogramBarEnter, onHistogramBarHover, onHistogramBarExit } =
        histogramInstances()[0].options;

      act(() => onHistogramBarEnter([0, 1]));
      act(() => onHistogramBarHover(50, 60));
      // "Base Pair Range" only exists in the tooltip table.
      expect(screen.getByText("Base Pair Range")).toBeTruthy();
      // The source joins the range with an en-dash; keep this file ASCII.
      expect(screen.getByText("100\u2013200")).toBeTruthy();

      act(() => onHistogramBarExit());
      expect(screen.queryByText("Base Pair Range")).toBeNull();
    });

    it("ignores hovers on other series", async () => {
      await renderAndLoad();
      const { onHistogramBarEnter, onHistogramBarHover } =
        histogramInstances()[0].options;

      act(() => onHistogramBarEnter([1, 0]));
      act(() => onHistogramBarHover(50, 60));
      expect(screen.queryByText("Base Pair Range")).toBeNull();
    });

    it("is torn down when the sidebar is closed", async () => {
      const view = await renderAndLoad();
      const { onHistogramBarEnter, onHistogramBarHover } =
        histogramInstances()[0].options;
      act(() => onHistogramBarEnter([0, 0]));
      act(() => onHistogramBarHover(50, 60));
      expect(screen.getByText("Base Pair Range")).toBeTruthy();

      await act(async () => {
        view.rerender(
          <CoverageVizBottomSidebar
            {...baseProps}
            visible={false}
            params={makeParams() as $TSFixMe}
          />,
        );
      });
      expect(screen.queryByText("Base Pair Range")).toBeNull();
    });
  });
});

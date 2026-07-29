// Frontend coverage: HitGroupViz draws one row of the coverage viz (a
// GenomeViz strip of contig/read hit groups) and owns two floating portals --
// the hover tooltip and the contig downloader. The D3 GenomeViz is stubbed so
// the tests can drive the exact callbacks the real viz fires (bar enter/hover/
// exit/click) and assert on the resulting React output instead of on SVG.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import copy from "copy-to-clipboard";
import { getContigsSequencesByByteranges } from "~/api";
import HitGroupViz from "~/components/common/CoverageVizBottomSidebar/HitGroupViz";
import GenomeViz from "~/components/visualizations/GenomeViz";

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

jest.mock("~/api", () => ({
  getContigsSequencesByByteranges: jest.fn(),
}));

jest.mock("copy-to-clipboard", () => ({
  __esModule: true,
  default: jest.fn(),
}));

// The real BasicPopup is a Semantic hover Popup, so its `content` never lands
// in the DOM unless a pointer hovers the trigger -- and the copy button's own
// onMouseEnter resets the very message we want to observe. Render the trigger
// and its content side by side instead so the tooltip copy is assertable.
jest.mock("~/components/common/BasicPopup", () => ({
  __esModule: true,
  default: ({ trigger, content }: $TSFixMe) => (
    <div>
      {trigger}
      <span data-testid="popup-content">{content}</span>
    </div>
  ),
}));

const mockedGetContigs = getContigsSequencesByByteranges as jest.MockedFunction<
  typeof getContigsSequencesByByteranges
>;
const mockedCopy = copy as unknown as jest.MockedFunction<typeof copy>;

const instances = () => (GenomeViz as $TSFixMe).__instances as $TSFixMe[];
const lastViz = () => instances()[instances().length - 1];

// hit group tuple:
// [numContigs, numReads, contigR, start, end, alignLen, percentId,
//  mismatches, gaps, binIndex, contigByteranges]
const contigHitGroup = [2, 0, 40, 100, 900, 800, 0.97, 4, 1, 0, [[10, 30]]];
const looseReadHitGroup = [0, 1, 0, 50, 60, 10, 0.8, 0, 0, 1, []];

const accessionData = {
  id: "ACC_1",
  total_length: 1000,
  coverage_bin_size: 100,
  coverage: [[0, 12, 0.5, 2, 3]],
  hit_groups: [contigHitGroup, looseReadHitGroup],
} as $TSFixMe;

const baseProps = {
  label: "NT Contigs (2)",
  hitGroups: [contigHitGroup, looseReadHitGroup] as $TSFixMe,
  accessionData,
  sampleId: 123,
  taxonId: 555,
  pipelineVersion: "8.0.0",
  color: "#006BE9",
};

const renderViz = (props = {}) =>
  render(<HitGroupViz {...baseProps} {...props} />);

describe("HitGroupViz", () => {
  beforeEach(() => {
    instances().length = 0;
    mockedGetContigs.mockReset();
    mockedCopy.mockReset();
  });

  it("renders the row label and builds a GenomeViz over the accession length", () => {
    renderViz();
    expect(screen.getByText("NT Contigs (2)")).toBeTruthy();

    const viz = lastViz();
    expect(viz).toBeDefined();
    expect(viz.options.domain).toEqual([0, 1000]);
    expect(viz.options.color).toBe("#006BE9");
    // generateContigReadVizData: the 2-contig group is aggregated so it snaps
    // to its bin, and the 10bp read is narrower than the 100bp bin, so it does
    // too.
    expect(viz.data).toEqual([
      [0, 100],
      [100, 200],
    ]);
    expect(viz.update).toHaveBeenCalled();
  });

  it("does not build a GenomeViz until accession data arrives", () => {
    const { rerender } = render(
      <HitGroupViz {...baseProps} accessionData={null as $TSFixMe} />,
    );
    expect(instances()).toHaveLength(0);

    rerender(<HitGroupViz {...baseProps} />);
    expect(instances()).toHaveLength(1);
  });

  describe("hover tooltip", () => {
    it("renders tooltip content only once both data and a location exist", () => {
      renderViz();
      const { onGenomeVizBarEnter, onGenomeVizBarHover, onGenomeVizBarExit } =
        lastViz().options;

      // Data alone is not enough to show the tooltip.
      act(() => onGenomeVizBarEnter(0));
      expect(screen.queryByText("Aggregated Contigs")).toBeNull();

      act(() => onGenomeVizBarHover(120, 240));
      expect(screen.getByText("Aggregated Contigs")).toBeTruthy();
      expect(screen.getByText("# NT Contigs")).toBeTruthy();

      // Exiting the bar tears the tooltip back down.
      act(() => onGenomeVizBarExit());
      expect(screen.queryByText("Aggregated Contigs")).toBeNull();
    });

    it("shows the loose-read tooltip for the read hit group", () => {
      renderViz();
      const { onGenomeVizBarEnter, onGenomeVizBarHover } = lastViz().options;
      act(() => onGenomeVizBarEnter(1));
      act(() => onGenomeVizBarHover(10, 20));
      expect(screen.getByText("Loose NT Read")).toBeTruthy();
    });

    it("ignores a null hover payload", () => {
      renderViz();
      const { onGenomeVizBarEnter, onGenomeVizBarHover } = lastViz().options;
      act(() => onGenomeVizBarEnter(null));
      act(() => onGenomeVizBarHover(10, 20));
      // No tooltip data was set, so nothing renders.
      expect(screen.queryByText("Loose NT Read")).toBeNull();
      expect(screen.queryByText("Aggregated Contigs")).toBeNull();
    });
  });

  describe("contig downloader", () => {
    const openDownloader = () => {
      const { onGenomeVizBarClick } = lastViz().options;
      act(() => onGenomeVizBarClick(0, 300, 400));
    };

    it("opens for a hit group that has contigs with byteranges", () => {
      renderViz();
      openDownloader();
      expect(document.querySelectorAll("button").length).toBe(2);
      expect(screen.getByText("Download Contig FASTA")).toBeTruthy();
      expect(
        screen.getByText("Copy Contig Sequence to Clipboard"),
      ).toBeTruthy();
    });

    it("stays closed for a hit group with no contigs", () => {
      renderViz();
      const { onGenomeVizBarClick } = lastViz().options;
      act(() => onGenomeVizBarClick(1, 300, 400));
      expect(document.querySelectorAll("button").length).toBe(0);
    });

    it("closes again on a null click index", () => {
      renderViz();
      openDownloader();
      expect(document.querySelectorAll("button").length).toBe(2);

      const { onGenomeVizBarClick } = lastViz().options;
      act(() => onGenomeVizBarClick(null));
      expect(document.querySelectorAll("button").length).toBe(0);
    });

    it("is suppressed entirely on a snapshot share link", () => {
      renderViz({ snapshotShareId: "abc123" });
      openDownloader();
      expect(document.querySelectorAll("button").length).toBe(0);
    });

    it("navigates to the byterange FASTA endpoint on download", () => {
      const originalLocation = window.location;
      // jsdom refuses real navigation, so swap in a plain object we can read.
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: { href: "" },
      });

      try {
        renderViz();
        openDownloader();
        const downloadButton = document.querySelectorAll("button")[0];
        fireEvent.click(downloadButton);

        expect(window.location.href).toContain(
          "/samples/123/contigs_fasta_by_byteranges?",
        );
        expect(window.location.href).toContain("pipelineVersion=8.0.0");
        expect(decodeURIComponent(window.location.href)).toContain("10,30");
      } finally {
        Object.defineProperty(window, "location", {
          configurable: true,
          writable: true,
          value: originalLocation,
        });
      }
    });

    it("copies the fetched sequences and swaps the copy tooltip message", async () => {
      mockedGetContigs.mockResolvedValue({
        contig_1: ">c1\nACGT",
        contig_2: ">c2\nTTTT",
      } as $TSFixMe);

      renderViz();
      openDownloader();
      const copyButton = document.querySelectorAll("button")[1];

      await act(async () => {
        fireEvent.click(copyButton);
      });

      expect(mockedGetContigs).toHaveBeenCalledWith(123, [[10, 30]], "8.0.0");
      expect(mockedCopy).toHaveBeenCalledWith(">c1\nACGT\n>c2\nTTTT");

      await waitFor(() =>
        expect(screen.getByText("Copied to clipboard!")).toBeTruthy(),
      );

      // Re-entering the icon restores the default prompt.
      act(() => {
        fireEvent.mouseEnter(copyButton);
      });
      await waitFor(() =>
        expect(
          screen.getByText("Copy Contig Sequence to Clipboard"),
        ).toBeTruthy(),
      );
      expect(screen.queryByText("Copied to clipboard!")).toBeNull();
    });

    it("closes and clears the bar outline on an outside mousedown", () => {
      renderViz();
      openDownloader();
      expect(document.querySelectorAll("button").length).toBe(2);

      act(() => {
        fireEvent.mouseDown(document.body);
      });

      expect(document.querySelectorAll("button").length).toBe(0);
      expect(lastViz().outlineBar).toHaveBeenCalledWith(null, false);
    });
  });
});

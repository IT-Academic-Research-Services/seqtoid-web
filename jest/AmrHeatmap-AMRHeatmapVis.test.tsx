// Frontend coverage: AMRHeatmapVis is the thin React wrapper around the D3
// Heatmap for the (deprecated) AMR heatmap. Its own logic is the data shaping
// -- picking gene vs allele rows, matching AMR counts to a row name, building
// the values matrix and the hover tooltip -- plus the callbacks the D3 layer
// fires back into React state. The D3 Heatmap is stubbed so those callbacks can
// be invoked directly and the resulting React output asserted.
import { act, render, screen } from "@testing-library/react";
import React from "react";
import AMRHeatmapVis from "~/components/views/AmrHeatmap/AMRHeatmapVis";
import Heatmap from "~/components/visualizations/heatmap/Heatmap";

jest.mock("~/components/visualizations/heatmap/Heatmap", () => {
  const instances: $TSFixMe[] = [];
  class MockHeatmap {
    container: $TSFixMe;
    data: $TSFixMe;
    options: $TSFixMe;
    start = jest.fn();
    updateData = jest.fn();
    updateScale = jest.fn();
    updateColumnMetadata = jest.fn();
    getCursorLocation = jest.fn(() => ({ left: 10, top: 20 }));
    getColumnMetadataLegend = jest.fn(() => ({
      California: "#ff0000",
      Unknown: "#cccccc",
    }));
    constructor(container: $TSFixMe, data: $TSFixMe, options: $TSFixMe) {
      this.container = container;
      this.data = data;
      this.options = options;
      instances.push(this);
    }
  }
  (MockHeatmap as $TSFixMe).__instances = instances;
  return { __esModule: true, default: MockHeatmap };
});

// MetadataSelector drags in the Semantic popup/search stack; the wrapper only
// cares that it is mounted with the right props and that its callbacks fire.
jest.mock("~/components/common/Heatmap/MetadataSelector", () => ({
  __esModule: true,
  default: ({
    metadataTypes,
    selectedMetadata,
    onMetadataSelectionChange,
    onMetadataSelectionClose,
  }: $TSFixMe) => (
    <div data-testid="metadata-selector">
      <span data-testid="metadata-options">
        {metadataTypes.map((t: $TSFixMe) => t.label).join(",")}
      </span>
      <span data-testid="metadata-selected">
        {Array.from(selectedMetadata).join(",")}
      </span>
      <button
        data-testid="change-metadata"
        onClick={() => onMetadataSelectionChange(new Set(["sample_type"]))}
      />
      <button data-testid="close-metadata" onClick={onMetadataSelectionClose} />
    </div>
  ),
}));

const instances = () => (Heatmap as $TSFixMe).__instances as $TSFixMe[];
const lastHeatmap = () => instances()[instances().length - 1];

const samplesMetadataTypes = {
  sample_type: { name: "Sample Type", key: "sample_type" },
  collection_location_v2: {
    name: "Collection Location",
    key: "collection_location_v2",
  },
};

const sampleOne = {
  sampleName: "Sample One",
  sampleId: 1,
  metadata: { collection_location_v2: "California" },
  amrCounts: [
    {
      gene: "ampC",
      annotation_gene: "ampC",
      allele: "ampC_1",
      coverage: 90,
      depth: 12,
      rpm: 5,
      dpm: 3,
      total_reads: 40,
    },
  ],
};

const sampleTwo = {
  sampleName: "Sample Two",
  sampleId: 2,
  metadata: {},
  // No counts at all -- every row must fall back to zero for this column.
  amrCounts: [],
};

const baseProps = {
  samplesWithAMRCounts: [sampleOne, sampleTwo],
  samplesMetadataTypes,
  sampleLabels: [
    { label: "Sample One", id: 1, metadata: sampleOne.metadata },
    { label: "Sample Two", id: 2, metadata: sampleTwo.metadata },
  ],
  geneLabels: [{ label: "ampC" }],
  alleleLabels: [{ label: "ampC_1" }],
  alleleToGeneMap: { ampC_1: "ampC" },
  metrics: [
    { text: "Coverage", value: "coverage" },
    { text: "RPM (reads per million)", value: "rpm" },
  ],
  selectedOptions: { metric: "coverage", viewLevel: "gene", scale: "symlog" },
  onSampleLabelClick: jest.fn(),
  onGeneLabelClick: jest.fn(),
};

const renderVis = (props: $TSFixMe = {}) => {
  const ref = React.createRef<$TSFixMe>();
  const utils = render(
    <AMRHeatmapVis ref={ref} {...(baseProps as $TSFixMe)} {...props} />,
  );
  return { ...utils, ref };
};

beforeEach(() => {
  instances().length = 0;
  jest.clearAllMocks();
});

describe("AMRHeatmapVis mounting", () => {
  it("builds and starts a Heatmap with gene rows and sample columns", () => {
    renderVis();
    const heatmap = lastHeatmap();
    expect(heatmap).toBeDefined();
    expect(heatmap.data.rowLabels).toEqual([{ label: "ampC" }]);
    expect(heatmap.data.columnLabels).toBe(baseProps.sampleLabels);
    // One row, one value per sample: 90 for the sample that has the gene, 0 for
    // the sample with no AMR counts.
    expect(heatmap.data.values).toEqual([[90, 0]]);
    expect(heatmap.options.scale).toBe("symlog");
    expect(heatmap.start).toHaveBeenCalledTimes(1);
  });

  it("uses allele rows when the view level is allele", () => {
    renderVis({
      selectedOptions: {
        metric: "depth",
        viewLevel: "allele",
        scale: "linear",
      },
    });
    const heatmap = lastHeatmap();
    expect(heatmap.data.rowLabels).toEqual([{ label: "ampC_1" }]);
    expect(heatmap.options.scale).toBe("linear");
  });

  it("seeds the column metadata with the default selection", () => {
    renderVis();
    expect(lastHeatmap().options.columnMetadata).toEqual([
      { label: "Collection Location", value: "collection_location_v2" },
    ]);
  });
});

describe("AMRHeatmapVis updates", () => {
  it("pushes new data and scale into the existing heatmap when options change", () => {
    const { rerender } = renderVis();
    const heatmap = lastHeatmap();

    rerender(
      <AMRHeatmapVis
        {...(baseProps as $TSFixMe)}
        selectedOptions={{
          metric: "rpm",
          viewLevel: "allele",
          scale: "linear",
        }}
      />,
    );

    // No second Heatmap is constructed -- the existing one is updated.
    expect(instances()).toHaveLength(1);
    expect(heatmap.updateData).toHaveBeenCalledTimes(1);
    expect(heatmap.updateData.mock.calls[0][0].rowLabels).toEqual([
      { label: "ampC_1" },
    ]);
    expect(heatmap.updateData.mock.calls[0][0].values).toEqual([[5, 0]]);
    expect(heatmap.updateScale).toHaveBeenCalledWith("linear");
  });

  it("does not touch the heatmap when nothing relevant changed", () => {
    const { rerender } = renderVis();
    const heatmap = lastHeatmap();

    rerender(<AMRHeatmapVis {...(baseProps as $TSFixMe)} />);

    expect(heatmap.updateData).not.toHaveBeenCalled();
    expect(heatmap.updateColumnMetadata).not.toHaveBeenCalled();
  });

  it("updates the column metadata when the metadata selection changes", () => {
    const { ref } = renderVis();
    const heatmap = lastHeatmap();

    act(() => {
      ref.current.onMetadataSelectionChange(new Set(["sample_type"]));
    });

    expect(heatmap.updateColumnMetadata).toHaveBeenCalledWith([
      { label: "Sample Type", value: "sample_type" },
    ]);
  });
});

describe("AMRHeatmapVis data helpers", () => {
  it("lists metadata types alphabetically by key", () => {
    const { ref } = renderVis();
    expect(ref.current.getMetadataTypes()).toEqual([
      { label: "Collection Location", value: "collection_location_v2" },
      { label: "Sample Type", value: "sample_type" },
    ]);
  });

  it("finds an AMR count by allele when the view level is allele", () => {
    const { ref } = renderVis({
      selectedOptions: { ...baseProps.selectedOptions, viewLevel: "allele" },
    });
    expect(ref.current.findAMRCountForName("ampC_1", sampleOne)).toBe(
      sampleOne.amrCounts[0],
    );
    expect(ref.current.findAMRCountForName("nope", sampleOne)).toBeUndefined();
  });

  it("falls back from annotation_gene to gene when matching a gene row", () => {
    const legacySample = {
      ...sampleOne,
      amrCounts: [{ ...sampleOne.amrCounts[0], annotation_gene: null }],
    };
    const { ref } = renderVis();
    // annotation_gene is null, so the lookup has to retry against `gene`.
    expect(ref.current.findAMRCountForName("ampC", legacySample)).toBe(
      legacySample.amrCounts[0],
    );
  });

  it("returns undefined for an unknown view level", () => {
    // Mounting with an unrecognised view level would blow up (there are no rows
    // to build a values matrix from), so exercise the switch defaults directly.
    const vis = new (AMRHeatmapVis as $TSFixMe)({
      ...baseProps,
      selectedOptions: { ...baseProps.selectedOptions, viewLevel: "mystery" },
    });
    expect(vis.getHeatmapLabels()).toBeUndefined();
    expect(vis.findAMRCountForName("ampC", sampleOne)).toBeUndefined();
    // With no row labels there is nothing to index into, so the tooltip path
    // cannot run at all.
    expect(() => vis.getTooltipData({ rowIndex: 0, columnIndex: 0 })).toThrow(
      TypeError,
    );
  });

  it("zero-fills the values matrix for rows a sample has no count for", () => {
    const { ref } = renderVis();
    expect(
      ref.current.computeHeatmapValues([{ label: "unknownGene" }]),
    ).toEqual([[0, 0]]);
  });

  it("greys out zero values via the custom colour callback", () => {
    const { ref } = renderVis();
    expect(ref.current.colorFilter(5, null, "#red", null, "#grey")).toBe(
      "#red",
    );
    expect(ref.current.colorFilter(0, null, "#red", null, "#grey")).toBe(
      "#grey",
    );
  });
});

describe("AMRHeatmapVis tooltip data", () => {
  it("reports the gene, its allele and bolds the selected metric", () => {
    const { ref } = renderVis();
    const data = ref.current.getTooltipData({ rowIndex: 0, columnIndex: 0 });

    expect(data[0].data).toEqual([
      ["Sample", "Sample One"],
      ["Gene", "ampC"],
      ["Allele", "ampC_1"],
    ]);
    // Selected metric (coverage) is wrapped in <b>; the other is a raw value.
    expect(React.isValidElement(data[1].data[0][1])).toBe(true);
    expect(data[1].data[1]).toEqual(["RPM (reads per million)", 5]);
  });

  it("shows --- for the allele when a gene row has no count in that sample", () => {
    const { ref } = renderVis();
    const data = ref.current.getTooltipData({ rowIndex: 0, columnIndex: 1 });
    expect(data[0].data).toEqual([
      ["Sample", "Sample Two"],
      ["Gene", "ampC"],
      ["Allele", "---"],
    ]);
    // No count at all for that column, so every metric is zero.
    expect(data[1].data[1]).toEqual(["RPM (reads per million)", 0]);
  });

  it("looks the gene up through the allele map in allele view", () => {
    const { ref } = renderVis({
      selectedOptions: { ...baseProps.selectedOptions, viewLevel: "allele" },
    });
    const data = ref.current.getTooltipData({ rowIndex: 0, columnIndex: 0 });
    expect(data[0].data).toEqual([
      ["Sample", "Sample One"],
      ["Gene", "ampC"],
      ["Allele", "ampC_1"],
    ]);
  });

  it("reports N/A when the matched count is missing the metric entirely", () => {
    const legacySample = {
      ...sampleOne,
      amrCounts: [{ ...sampleOne.amrCounts[0], rpm: null }],
    };
    const { ref } = renderVis({
      samplesWithAMRCounts: [legacySample, sampleTwo],
    });
    const data = ref.current.getTooltipData({ rowIndex: 0, columnIndex: 0 });
    expect(data[1].data[1]).toEqual(["RPM (reads per million)", "N/A"]);
  });

  it("rewrites a zero to N/A when the sample predates the rpm metric", () => {
    // The sample has counts, but none for the hovered gene -- so the raw value
    // is 0. Because its other counts have no rpm at all, the sample is too old
    // to have evaluated the metric and the 0 must be shown as N/A instead.
    const oldPipelineSample = {
      ...sampleTwo,
      amrCounts: [
        {
          gene: "otherGene",
          annotation_gene: "otherGene",
          allele: "otherGene_1",
          coverage: 10,
          depth: 2,
          rpm: null,
        },
      ],
    };
    const { ref } = renderVis({
      samplesWithAMRCounts: [sampleOne, oldPipelineSample],
    });
    const data = ref.current.getTooltipData({ rowIndex: 0, columnIndex: 1 });
    expect(data[1].data[1]).toEqual(["RPM (reads per million)", "N/A"]);
    // Coverage is exempt from the rewrite -- it is reported as a real zero.
    expect(data[1].data[0][1].props.children).toBe(0);
  });

  it("keeps the zero when the sample did evaluate the rpm metric", () => {
    const newPipelineSample = {
      ...sampleTwo,
      amrCounts: [
        {
          gene: "otherGene",
          annotation_gene: "otherGene",
          allele: "otherGene_1",
          coverage: 10,
          depth: 2,
          rpm: 7,
        },
      ],
    };
    const { ref } = renderVis({
      samplesWithAMRCounts: [sampleOne, newPipelineSample],
    });
    const data = ref.current.getTooltipData({ rowIndex: 0, columnIndex: 1 });
    expect(data[1].data[1]).toEqual(["RPM (reads per million)", 0]);
  });
});

describe("AMRHeatmapVis interaction callbacks", () => {
  it("renders and clears the node hover tooltip", () => {
    const { ref } = renderVis();
    expect(screen.queryByText("Sample One")).toBeNull();

    act(() => ref.current.onNodeHover({ rowIndex: 0, columnIndex: 0 }));
    expect(screen.getByText("Sample One")).not.toBeNull();

    act(() => ref.current.onNodeHoverOut());
    expect(screen.queryByText("Sample One")).toBeNull();
  });

  it("passes the row label straight through in gene view", () => {
    const onGeneLabelClick = jest.fn();
    const { ref } = renderVis({ onGeneLabelClick });
    act(() => ref.current.onRowLabelClick("ampC"));
    expect(onGeneLabelClick).toHaveBeenCalledWith("ampC");
  });

  it("translates an allele row label into its gene", () => {
    const onGeneLabelClick = jest.fn();
    const { ref } = renderVis({
      onGeneLabelClick,
      selectedOptions: { ...baseProps.selectedOptions, viewLevel: "allele" },
    });
    act(() => ref.current.onRowLabelClick("ampC_1"));
    expect(onGeneLabelClick).toHaveBeenCalledWith("ampC");
  });

  it("shows the full metadata legend on label hover and hides it on out", () => {
    const { ref } = renderVis();
    act(() =>
      ref.current.onMetadataLabelHover({ value: "collection_location_v2" }),
    );
    expect(screen.getByText("California")).not.toBeNull();

    act(() => ref.current.onMetadataLabelOut());
    expect(screen.queryByText("California")).toBeNull();
  });

  it("shows only the hovered sample's value on metadata node hover", () => {
    const { ref } = renderVis();
    act(() =>
      ref.current.onMetadataNodeHover(
        { metadata: { collection_location_v2: "California" } },
        { value: "collection_location_v2" },
      ),
    );
    expect(screen.getByText("California")).not.toBeNull();
    expect(screen.queryByText("Unknown")).toBeNull();
  });

  it("falls back to Unknown when the sample has no value for that field", () => {
    const { ref } = renderVis();
    act(() =>
      ref.current.onMetadataNodeHover(
        { metadata: {} },
        { value: "collection_location_v2" },
      ),
    );
    expect(screen.getByText("Unknown")).not.toBeNull();
    expect(screen.queryByText("California")).toBeNull();
  });

  it("opens the metadata selector on the add button and closes it again", () => {
    const { ref } = renderVis();
    expect(screen.queryByTestId("metadata-selector")).toBeNull();

    act(() =>
      ref.current.onMetadataAddButtonClick(document.createElement("div")),
    );
    expect(screen.getByTestId("metadata-options").textContent).toBe(
      "Collection Location,Sample Type",
    );
    expect(screen.getByTestId("metadata-selected").textContent).toBe(
      "collection_location_v2",
    );

    act(() => {
      screen.getByTestId("close-metadata").click();
    });
    expect(screen.queryByTestId("metadata-selector")).toBeNull();
  });
});

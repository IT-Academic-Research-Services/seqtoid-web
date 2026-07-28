// Frontend coverage: AMRHeatmapView is the container for the deprecated AMR
// heatmap. It fetches AMR counts + metadata, then reshapes them into the row /
// column / label structures the visualization needs (de-duplicating sample
// names, stripping the drug class off legacy gene names, mapping alleles to
// genes) and owns the sidebar toggling and CSV export. The heavy leaf
// components and the two API calls are stubbed so the container's own logic is
// what is under test.
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { getAMRCounts } from "~/api/amr";
import { getSampleMetadataFields } from "~/api/metadata";
import AMRHeatmapView from "~/components/views/AmrHeatmap/AMRHeatmapView";

jest.mock("~/api/amr", () => ({ getAMRCounts: jest.fn() }));
jest.mock("~/api/metadata", () => ({ getSampleMetadataFields: jest.fn() }));

// The visualization itself is exercised by its own suite; here we only care
// which props the container hands it.
jest.mock("~/components/views/AmrHeatmap/AMRHeatmapVis", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div
      data-testid="amr-vis"
      data-genes={props.geneLabels.map((g: $TSFixMe) => g.label).join(",")}
      data-alleles={props.alleleLabels.map((a: $TSFixMe) => a.label).join(",")}
      data-samples={props.sampleLabels.map((s: $TSFixMe) => s.label).join(",")}
      data-view-level={props.selectedOptions.viewLevel}
    />
  ),
}));

jest.mock("~/components/views/AmrHeatmap/AMRHeatmapControls", () => ({
  __esModule: true,
  default: ({ maxValueForLegend, isDataReady }: $TSFixMe) => (
    <div
      data-testid="amr-controls"
      data-max={String(maxValueForLegend)}
      data-ready={String(isDataReady)}
    />
  ),
}));

jest.mock("~/components/common/DetailsSidebar", () => ({
  __esModule: true,
  default: ({ visible, mode, params }: $TSFixMe) => (
    <div
      data-testid="details-sidebar"
      data-visible={String(visible)}
      data-mode={String(mode)}
      data-params={JSON.stringify(
        params
          ? { sampleId: params.sampleId, geneName: params.geneName }
          : null,
      )}
    />
  ),
}));

jest.mock("~ui/controls/dropdowns", () => ({
  __esModule: true,
  DownloadButtonDropdown: ({ options }: $TSFixMe) => (
    <div data-testid="download-dropdown">{options[0].text}</div>
  ),
}));

const mockedGetAMRCounts = getAMRCounts as jest.MockedFunction<
  typeof getAMRCounts
>;
const mockedGetMetadataFields = getSampleMetadataFields as jest.MockedFunction<
  typeof getSampleMetadataFields
>;

const metadataFields = [
  {
    key: "collection_location_v2",
    name: "Collection Location",
    dataType: "string",
  },
];

const amrCount = (overrides: $TSFixMe = {}) => ({
  gene: "ampC_beta_lactam",
  annotation_gene: "ampC",
  allele: "ampC_1",
  coverage: 90,
  depth: 12,
  rpm: 5,
  dpm: 3,
  total_reads: 40,
  ...overrides,
});

const rawSample = (overrides: $TSFixMe = {}) => ({
  sampleName: "Sample One",
  sampleId: 1,
  error: "",
  metadata: [
    {
      key: "collection_location_v2",
      base_type: "string",
      string_validated_value: "California",
    },
  ],
  amrCounts: [amrCount()],
  ...overrides,
});

const renderView = async (rawSamples: $TSFixMe[], sampleIds = [1, 2]) => {
  mockedGetAMRCounts.mockResolvedValue(rawSamples as $TSFixMe);
  mockedGetMetadataFields.mockResolvedValue(metadataFields as $TSFixMe);
  const ref = React.createRef<$TSFixMe>();
  const utils = render(<AMRHeatmapView ref={ref} sampleIds={sampleIds} />);
  await waitFor(() => expect(ref.current.state.loading).toBe(false));
  return { ...utils, ref };
};

beforeAll(() => {
  // jsdom has no object URL support; the CSV download link only needs a string.
  (URL as $TSFixMe).createObjectURL = jest.fn(() => "blob:csv");
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AMRHeatmapView loading", () => {
  it("shows the loading message until both requests resolve", async () => {
    mockedGetAMRCounts.mockResolvedValue([rawSample()] as $TSFixMe);
    mockedGetMetadataFields.mockResolvedValue(metadataFields as $TSFixMe);
    render(<AMRHeatmapView sampleIds={[1]} />);

    expect(screen.getByText("Loading...")).not.toBeNull();
    // No visualization and no download control while loading.
    expect(screen.queryByTestId("amr-vis")).toBeNull();
    expect(screen.queryByTestId("download-dropdown")).toBeNull();

    await waitFor(() => expect(screen.queryByTestId("amr-vis")).not.toBeNull());
    expect(screen.queryByText("Loading...")).toBeNull();
    expect(screen.getByTestId("download-dropdown")).not.toBeNull();
  });

  it("requests both AMR counts and metadata for the given sample ids", async () => {
    await renderView([rawSample()], [7, 8]);
    expect(mockedGetAMRCounts).toHaveBeenCalledWith([7, 8]);
    expect(mockedGetMetadataFields).toHaveBeenCalledWith([7, 8]);
  });

  it("always shows the deprecation warning", async () => {
    await renderView([rawSample()]);
    expect(screen.getByText(/deprecated version of our/)).not.toBeNull();
  });
});

describe("AMRHeatmapView data shaping", () => {
  it("drops samples that came back with an error", async () => {
    const { ref } = await renderView([
      rawSample(),
      rawSample({ sampleName: "Broken", sampleId: 2, error: "boom" }),
    ]);
    expect(ref.current.state.samplesWithAMRCounts).toHaveLength(1);
    expect(screen.getByTestId("amr-vis").getAttribute("data-samples")).toBe(
      "Sample One",
    );
  });

  it("strips the drug class suffix off legacy gene names", async () => {
    const { ref } = await renderView([rawSample()]);
    expect(ref.current.state.samplesWithAMRCounts[0].amrCounts[0].gene).toBe(
      "ampC",
    );
  });

  it("numbers duplicate sample names so columns stay distinguishable", async () => {
    const { ref } = await renderView([
      rawSample(),
      rawSample({ sampleId: 2 }),
      rawSample({ sampleId: 3 }),
    ]);
    expect(
      ref.current.state.sampleLabels.map((s: $TSFixMe) => s.label),
    ).toEqual(["Sample One", "Sample One (1)", "Sample One (2)"]);
  });

  it("flattens the metadata list into a keyed object", async () => {
    const { ref } = await renderView([rawSample()]);
    expect(
      ref.current.state.samplesWithAMRCounts[0].metadata.collection_location_v2,
    ).toBe("California");
  });

  it("prefers annotation_gene for gene labels but falls back to gene", async () => {
    const { ref } = await renderView([
      rawSample({
        amrCounts: [
          amrCount(),
          amrCount({
            gene: "tetA_tetracycline",
            annotation_gene: null,
            allele: "tetA_1",
          }),
          amrCount({
            gene: "mecA_methicillin",
            annotation_gene: undefined,
            allele: "mecA_1",
          }),
        ],
      }),
    ]);
    expect(ref.current.state.geneLabels.map((g: $TSFixMe) => g.label)).toEqual([
      "ampC",
      "tetA",
      "mecA",
    ]);
    expect(
      ref.current.state.alleleLabels.map((a: $TSFixMe) => a.label),
    ).toEqual(["ampC_1", "tetA_1", "mecA_1"]);
  });

  it("maps each allele to its gene, preferring annotation_gene", async () => {
    const { ref } = await renderView([
      rawSample({
        amrCounts: [
          amrCount(),
          amrCount({
            gene: "tetA_tetracycline",
            annotation_gene: null,
            allele: "tetA_1",
          }),
        ],
      }),
    ]);
    expect(ref.current.state.alleleToGeneMap).toEqual({
      ampC_1: "ampC",
      // annotation_gene is null, so the (already trimmed) gene name is used.
      tetA_1: "tetA",
    });
  });

  it("takes the max of every metric across all counts, defaulting blanks to 0", async () => {
    const { ref } = await renderView([
      rawSample({
        amrCounts: [
          amrCount({ coverage: 10, depth: 1, rpm: 5, dpm: 2, total_reads: 30 }),
          amrCount({
            allele: "ampC_2",
            coverage: 80,
            depth: 9,
            rpm: null,
            dpm: undefined,
            total_reads: 0,
          }),
        ],
      }),
    ]);
    expect(ref.current.state.maxValues).toEqual({
      coverage: 80,
      depth: 9,
      rpm: 5,
      dpm: 2,
      total_reads: 30,
    });
    // The controls legend uses the max for the currently selected metric.
    expect(screen.getByTestId("amr-controls").getAttribute("data-max")).toBe(
      "80",
    );
  });

  it("shows a no-data message when no sample has any AMR counts", async () => {
    await renderView([rawSample({ amrCounts: [] })]);
    expect(
      screen.getByText(
        "No Antimicrobial Resistance data for selected samples.",
      ),
    ).not.toBeNull();
    expect(screen.queryByTestId("amr-vis")).toBeNull();
  });
});

describe("AMRHeatmapView options", () => {
  it("defaults to the gene view with the coverage metric", async () => {
    const { ref } = await renderView([rawSample()]);
    expect(ref.current.state.selectedOptions).toEqual({
      metric: "coverage",
      viewLevel: "gene",
      scale: "symlog",
    });
    expect(screen.getByTestId("amr-vis").getAttribute("data-view-level")).toBe(
      "gene",
    );
  });

  it("merges partial option updates into the existing selection", async () => {
    const { ref } = await renderView([rawSample()]);
    act(() => ref.current.updateOptions({ viewLevel: "allele" }));

    expect(ref.current.state.selectedOptions).toEqual({
      metric: "coverage",
      viewLevel: "allele",
      scale: "symlog",
    });
    expect(screen.getByTestId("amr-vis").getAttribute("data-view-level")).toBe(
      "allele",
    );
  });

  it("exposes the three control groups in display order", async () => {
    const { ref } = await renderView([rawSample()]);
    expect(
      ref.current.assembleControlOptions().map((c: $TSFixMe) => c.key),
    ).toEqual(["viewLevel", "metric", "scale"]);
  });
});

describe("AMRHeatmapView sidebar", () => {
  const sidebar = () => screen.getByTestId("details-sidebar");

  it("starts hidden with no mode and no params", async () => {
    await renderView([rawSample()]);
    expect(sidebar().getAttribute("data-visible")).toBe("false");
    expect(sidebar().getAttribute("data-params")).toBe("null");
  });

  it("opens sample details when a sample label is clicked", async () => {
    const { ref } = await renderView([rawSample()]);
    act(() => ref.current.onSampleLabelClick(1));

    expect(sidebar().getAttribute("data-visible")).toBe("true");
    expect(sidebar().getAttribute("data-mode")).toBe("sampleDetails");
    expect(JSON.parse(sidebar().getAttribute("data-params") as string)).toEqual(
      { sampleId: 1 },
    );
  });

  it("closes the sidebar when the same sample label is clicked twice", async () => {
    const { ref } = await renderView([rawSample()]);
    act(() => ref.current.onSampleLabelClick(1));
    act(() => ref.current.onSampleLabelClick(1));
    expect(sidebar().getAttribute("data-visible")).toBe("false");
  });

  it("switches to a different sample rather than closing", async () => {
    const { ref } = await renderView([rawSample()]);
    act(() => ref.current.onSampleLabelClick(1));
    act(() => ref.current.onSampleLabelClick(2));

    expect(sidebar().getAttribute("data-visible")).toBe("true");
    expect(ref.current.state.selectedSampleId).toBe(2);
  });

  it("closes the sidebar when the sample label click carries no id", async () => {
    const { ref } = await renderView([rawSample()]);
    act(() => ref.current.onSampleLabelClick(1));
    act(() => ref.current.onSampleLabelClick(null));
    expect(sidebar().getAttribute("data-visible")).toBe("false");
  });

  it("opens gene details when a gene label is clicked", async () => {
    const { ref } = await renderView([rawSample()]);
    act(() => ref.current.onGeneLabelClick("ampC"));

    expect(sidebar().getAttribute("data-mode")).toBe("geneDetails");
    expect(JSON.parse(sidebar().getAttribute("data-params") as string)).toEqual(
      { geneName: "ampC" },
    );
  });

  it("closes the sidebar when the same gene is clicked twice", async () => {
    const { ref } = await renderView([rawSample()]);
    act(() => ref.current.onGeneLabelClick("ampC"));
    act(() => ref.current.onGeneLabelClick("ampC"));
    expect(sidebar().getAttribute("data-visible")).toBe("false");
  });

  it("closes the sidebar when the gene label click carries no name", async () => {
    const { ref } = await renderView([rawSample()]);
    act(() => ref.current.onGeneLabelClick("ampC"));
    act(() => ref.current.onGeneLabelClick(""));
    expect(sidebar().getAttribute("data-visible")).toBe("false");
  });

  it("switches from sample details to gene details", async () => {
    const { ref } = await renderView([rawSample()]);
    act(() => ref.current.onSampleLabelClick(1));
    act(() => ref.current.onGeneLabelClick("ampC"));

    expect(sidebar().getAttribute("data-visible")).toBe("true");
    expect(sidebar().getAttribute("data-mode")).toBe("geneDetails");
  });
});

describe("AMRHeatmapView metadata updates", () => {
  it("writes the new value onto the selected sample only", async () => {
    const { ref } = await renderView([
      rawSample(),
      rawSample({ sampleName: "Sample Two", sampleId: 2 }),
    ]);
    act(() => ref.current.onSampleLabelClick(2));
    act(() => ref.current.onMetadataUpdate("collection_location_v2", "Oregon"));

    const [first, second] = ref.current.state.samplesWithAMRCounts;
    expect(first.metadata.collection_location_v2).toBe("California");
    expect(second.metadata.collection_location_v2).toBe("Oregon");
    // Sample labels are rebuilt so the heatmap picks up the new metadata.
    expect(
      ref.current.state.sampleLabels[1].metadata.collection_location_v2,
    ).toBe("Oregon");
  });
});

describe("AMRHeatmapView CSV export", () => {
  it("emits one row per AMR count with an N/A for absent metrics", async () => {
    const { ref } = await renderView([
      rawSample({
        amrCounts: [
          amrCount(),
          amrCount({
            allele: "ampC_2",
            coverage: 50,
            depth: 4,
            rpm: null,
            dpm: null,
            total_reads: null,
          }),
        ],
      }),
    ]);
    const [headers, rows] = ref.current.computeHeatmapValuesForCSV();

    expect(headers).toEqual([
      "sample_name,gene_name,allele_name,coverage,depth,rpm,dpm,mapped_reads",
    ]);
    expect(rows).toEqual([
      ["Sample One,ampC,ampC_1,90,12,5,3,40"],
      ["Sample One,ampC,ampC_2,50,4,N/A,N/A,N/A"],
    ]);
  });

  it("offers a single csv download option backed by an object URL", async () => {
    const { ref } = await renderView([rawSample()]);
    const options = ref.current.getDownloadOptions();

    expect(options).toHaveLength(1);
    expect(options[0].value).toBe("csv");
    expect(screen.getByTestId("download-dropdown").textContent).toBe(
      "Download CSV",
    );
    expect((URL as $TSFixMe).createObjectURL).toHaveBeenCalled();
  });
});
